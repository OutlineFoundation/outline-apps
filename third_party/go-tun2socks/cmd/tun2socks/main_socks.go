// +build socks

package main

import (
	"net"

	"github.com/eycorsican/go-tun2socks/common/log"
	"github.com/eycorsican/go-tun2socks/core"
	"github.com/eycorsican/go-tun2socks/proxy/socks"
)

func init() {
	args.addFlag(fProxyServer)
	args.addFlag(fUdpTimeout)

	registerHandlerCreater("socks", func() {
		// Verify proxy server address.
		proxyAddr, err := net.ResolveTCPAddr("tcp", *args.ProxyServer)
		if err != nil {
			log.Fatalf("invalid proxy server address: %v", err)
		}
		proxyHost := proxyAddr.IP.String()
		proxyPort := uint16(proxyAddr.Port)

		core.RegisterTCPConnHandler(socks.NewTCPHandler(proxyHost, proxyPort))
		core.RegisterUDPConnHandler(socks.NewUDPHandler(proxyHost, proxyPort, *args.UdpTimeout))
	})
}
