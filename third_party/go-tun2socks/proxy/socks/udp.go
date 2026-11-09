package socks

import (
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"time"

	"github.com/eycorsican/go-tun2socks/common/log"
	"github.com/eycorsican/go-tun2socks/core"
)

// max IP packet size - min IP header size - min UDP header size - min SOCKS5 header size
const maxUdpPayloadSize = 65535 - 20 - 8 - 7

type udpHandler struct {
	sync.Mutex

	proxyHost   string
	proxyPort   uint16
	udpConns    map[core.UDPConn]net.PacketConn
	tcpConns    map[core.UDPConn]net.Conn
	remoteAddrs map[core.UDPConn]*net.UDPAddr // UDP relay server addresses
	timeout     time.Duration
}

func NewUDPHandler(proxyHost string, proxyPort uint16, timeout time.Duration) core.UDPConnHandler {
	return &udpHandler{
		proxyHost:   proxyHost,
		proxyPort:   proxyPort,
		udpConns:    make(map[core.UDPConn]net.PacketConn, 8),
		tcpConns:    make(map[core.UDPConn]net.Conn, 8),
		remoteAddrs: make(map[core.UDPConn]*net.UDPAddr, 8),
		timeout:     timeout,
	}
}

func (h *udpHandler) handleTCP(conn core.UDPConn, c net.Conn) {
	buf := core.NewBytes(core.BufSize)

	defer func() {
		h.Close(conn)
		core.FreeBytes(buf)
	}()

	for {
		c.SetDeadline(time.Time{})
		if _, err := c.Read(buf); err != nil {
			return
		}
	}
}

func (h *udpHandler) fetchUDPInput(conn core.UDPConn, input net.PacketConn) {
	buf := core.NewBytes(maxUdpPayloadSize)

	defer func() {
		h.Close(conn)
		core.FreeBytes(buf)
	}()

	for {
		input.SetDeadline(time.Now().Add(h.timeout))
		n, _, err := input.ReadFrom(buf)
		if err != nil {
			return
		}
		if n < 3 {
			continue
		}
		addr := SplitAddr(buf[3:n])
		if addr == nil {
			continue
		}
		resolvedAddr, err := net.ResolveUDPAddr("udp", addr.String())
		if err != nil {
			continue
		}
		_, err = conn.WriteFrom(buf[int(3+len(addr)):n], resolvedAddr)
		if err != nil {
			log.Warnf("write local failed: %v", err)
			return
		}
	}
}

func (h *udpHandler) Connect(conn core.UDPConn, target *net.UDPAddr) error {
	if target == nil {
		return h.connectInternal(conn, "")
	}
	return h.connectInternal(conn, target.String())
}

func (h *udpHandler) connectInternal(conn core.UDPConn, dest string) error {
	c, err := net.DialTimeout("tcp", core.ParseTCPAddr(h.proxyHost, h.proxyPort).String(), 4*time.Second)
	if err != nil {
		return err
	}

	// send VER, NMETHODS, METHODS
	c.Write([]byte{5, 1, 0})

	buf := make([]byte, MaxAddrLen)
	// read VER METHOD
	if _, err := io.ReadFull(c, buf[:2]); err != nil {
		return err
	}

	c.Write(append([]byte{5, socks5UDPAssociate, 0}, []byte{1, 0, 0, 0, 0, 0, 0}...))
	
	// read VER REP RSV ATYP BND.ADDR BND.PORT
	if _, err := io.ReadFull(c, buf[:3]); err != nil {
		return err
	}

	rep := buf[1]
	if rep != 0 {
		return errors.New("SOCKS handshake failed")
	}

	remoteAddr, err := readAddr(c, buf)
	if err != nil {
		return err
	}

	resolvedRemoteAddr, err := net.ResolveUDPAddr("udp", remoteAddr.String())
	if err != nil {
		return errors.New("failed to resolve remote address")
	}

	go h.handleTCP(conn, c)

	pc, err := net.ListenPacket("udp", "")
	if err != nil {
		return err
	}

	h.Lock()
	h.tcpConns[conn] = c
	h.udpConns[conn] = pc
	h.remoteAddrs[conn] = resolvedRemoteAddr
	h.Unlock()

	go h.fetchUDPInput(conn, pc)

	log.Infof("new proxy connection to %v", dest)

	return nil
}

func (h *udpHandler) ReceiveTo(conn core.UDPConn, data []byte, addr *net.UDPAddr) error {
	h.Lock()
	pc, ok1 := h.udpConns[conn]
	remoteAddr, ok2 := h.remoteAddrs[conn]
	h.Unlock()

	if ok1 && ok2 {
		buf := append([]byte{0, 0, 0}, ParseAddr(addr.String())...)
		buf = append(buf, data[:]...)
		_, err := pc.WriteTo(buf, remoteAddr)
		if err != nil {
			h.Close(conn)
			return errors.New(fmt.Sprintf("write remote failed: %v", err))
		}
		return nil
	} else {
		h.Close(conn)
		return errors.New(fmt.Sprintf("proxy connection %v->%v does not exists", conn.LocalAddr(), addr))
	}
}

func (h *udpHandler) Close(conn core.UDPConn) {
	conn.Close()

	h.Lock()
	defer h.Unlock()

	if c, ok := h.tcpConns[conn]; ok {
		c.Close()
		delete(h.tcpConns, conn)
	}
	if pc, ok := h.udpConns[conn]; ok {
		pc.Close()
		delete(h.udpConns, conn)
	}
	delete(h.remoteAddrs, conn)
}
