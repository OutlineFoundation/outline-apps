// Code in this file are grabbed from https://github.com/nadoo/glider, which
// is also referencing another repo: https://github.com/shadowsocks/go-shadowsocks2

package socks

import (
	"errors"
	"io"
	"net"
	"strconv"
)

// SOCKS request commands as defined in RFC 1928 section 4.
const (
	socks5Connect      = 1
	socks5Bind         = 2
	socks5UDPAssociate = 3
)

// SOCKS address types as defined in RFC 1928 section 5.
const (
	socks5IP4    = 1
	socks5Domain = 3
	socks5IP6    = 4
)

var socks5Errors = []error{
	errors.New(""),
	errors.New("general failure"),
	errors.New("connection forbidden"),
	errors.New("network unreachable"),
	errors.New("host unreachable"),
	errors.New("connection refused"),
	errors.New("TTL expired"),
	errors.New("command not supported"),
	errors.New("address type not supported"),
	errors.New("socks5UDPAssociate"),
}

// MaxAddrLen is the maximum size of SOCKS address in bytes.
const MaxAddrLen = 1 + 1 + 255 + 2

// ATYP return the address type
func ATYP(b byte) int {
	return int(b &^ 0x8)
}

// Addr represents a SOCKS address as defined in RFC 1928 section 5.
type Addr []byte

// String serializes SOCKS address a to string form.
func (a Addr) String() string {
	var host, port string

	switch ATYP(a[0]) { // address type
	case socks5Domain:
		host = string(a[2 : 2+int(a[1])])
		port = strconv.Itoa((int(a[2+int(a[1])]) << 8) | int(a[2+int(a[1])+1]))
	case socks5IP4:
		host = net.IP(a[1 : 1+net.IPv4len]).String()
		port = strconv.Itoa((int(a[1+net.IPv4len]) << 8) | int(a[1+net.IPv4len+1]))
	case socks5IP6:
		host = net.IP(a[1 : 1+net.IPv6len]).String()
		port = strconv.Itoa((int(a[1+net.IPv6len]) << 8) | int(a[1+net.IPv6len+1]))
	}

	return net.JoinHostPort(host, port)
}

// ParseAddr parses the address in string s. Returns nil if failed.
func ParseAddr(s string) Addr {
	var addr Addr
	host, port, err := net.SplitHostPort(s)
	if err != nil {
		return nil
	}
	if ip := net.ParseIP(host); ip != nil {
		if ip4 := ip.To4(); ip4 != nil {
			addr = make([]byte, 1+net.IPv4len+2)
			addr[0] = socks5IP4
			copy(addr[1:], ip4)
		} else {
			addr = make([]byte, 1+net.IPv6len+2)
			addr[0] = socks5IP6
			copy(addr[1:], ip)
		}
	} else {
		if len(host) > 255 {
			return nil
		}
		addr = make([]byte, 1+1+len(host)+2)
		addr[0] = socks5Domain
		addr[1] = byte(len(host))
		copy(addr[2:], host)
	}

	portnum, err := strconv.ParseUint(port, 10, 16)
	if err != nil {
		return nil
	}

	addr[len(addr)-2], addr[len(addr)-1] = byte(portnum>>8), byte(portnum)

	return addr
}

func readAddr(r io.Reader, b []byte) (Addr, error) {
	if len(b) < MaxAddrLen {
		return nil, io.ErrShortBuffer
	}
	_, err := io.ReadFull(r, b[:1]) // read 1st byte for address type
	if err != nil {
		return nil, err
	}

	switch ATYP(b[0]) {
	case socks5Domain:
		_, err = io.ReadFull(r, b[1:2]) // read 2nd byte for domain length
		if err != nil {
			return nil, err
		}
		_, err = io.ReadFull(r, b[2:2+int(b[1])+2])
		return b[:1+1+int(b[1])+2], err
	case socks5IP4:
		_, err = io.ReadFull(r, b[1:1+net.IPv4len+2])
		return b[:1+net.IPv4len+2], err
	case socks5IP6:
		_, err = io.ReadFull(r, b[1:1+net.IPv6len+2])
		return b[:1+net.IPv6len+2], err
	}

	return nil, socks5Errors[8]
}

// SplitAddr slices a SOCKS address from beginning of b. Returns nil if failed.
func SplitAddr(b []byte) Addr {
	addrLen := 1
	if len(b) < addrLen {
		return nil
	}

	switch ATYP(b[0]) {
	case socks5Domain:
		if len(b) < 2 {
			return nil
		}
		addrLen = 1 + 1 + int(b[1]) + 2
	case socks5IP4:
		addrLen = 1 + net.IPv4len + 2
	case socks5IP6:
		addrLen = 1 + net.IPv6len + 2
	default:
		return nil

	}

	if len(b) < addrLen {
		return nil
	}

	return b[:addrLen]
}
