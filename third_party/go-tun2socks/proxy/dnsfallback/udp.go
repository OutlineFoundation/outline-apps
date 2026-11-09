package dnsfallback

import (
	"encoding/binary"
	"errors"
	"net"

	"github.com/eycorsican/go-tun2socks/common/dns"
	"github.com/eycorsican/go-tun2socks/core"
)

// UDP handler that intercepts DNS queries and replies with a truncated response (TC bit)
// in order for the client to retry over TCP. This DNS/TCP fallback mechanism is
// useful for proxy servers that do not support UDP.
// Note that non-DNS UDP traffic is dropped.
type udpHandler struct{}

const (
	dnsHeaderLength = 12
	dnsMaskQr       = uint8(0x80)
	dnsMaskTc       = uint8(0x02)
	dnsMaskRcode    = uint8(0x0F)
)

func NewUDPHandler() core.UDPConnHandler {
	return &udpHandler{}
}

func (h *udpHandler) Connect(conn core.UDPConn, udpAddr *net.UDPAddr) error {
	if udpAddr.Port != dns.COMMON_DNS_PORT {
		return errors.New("Cannot handle non-DNS packet")
	}
	return nil
}

func (h *udpHandler) ReceiveTo(conn core.UDPConn, data []byte, addr *net.UDPAddr) error {
	if len(data) < dnsHeaderLength {
		return errors.New("Received malformed DNS query")
	}
	//  DNS Header
	//  0  1  2  3  4  5  6  7  0  1  2  3  4  5  6  7
	//  +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	//  |                      ID                       |
	//  +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	//  |QR|   Opcode  |AA|TC|RD|RA|   Z    |   RCODE   |
	//  +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	//  |                    QDCOUNT                    |
	//  +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	//  |                    ANCOUNT                    |
	//  +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	//  |                    NSCOUNT                    |
	//  +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	//  |                    ARCOUNT                    |
	//  +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// Set response and truncated bits
	data[2] |= dnsMaskQr | dnsMaskTc
	// Set response code to 'no error'.
	data[3] &= ^dnsMaskRcode
	// Set ANCOUNT to QDCOUNT. This is technically incorrect, since the response does not
	// include an answer. However, without it some DNS clients (i.e. Windows 7) do not retry
	// over TCP.
	var qdcount = binary.BigEndian.Uint16(data[4:6])
	binary.BigEndian.PutUint16(data[6:], qdcount)
	_, err := conn.WriteFrom(data, addr)
	return err
}
