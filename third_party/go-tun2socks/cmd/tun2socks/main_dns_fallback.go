// +build dnsfallback

package main

import (
	"flag"

	"github.com/eycorsican/go-tun2socks/core"
	"github.com/eycorsican/go-tun2socks/proxy/dnsfallback"
)

func init() {
	args.DnsFallback = flag.Bool("dnsFallback", false, "Enable DNS fallback over TCP (overrides the UDP proxy handler).")

	registerHandlerCreater("dnsfallback", func() {
		core.RegisterUDPConnHandler(dnsfallback.NewUDPHandler())
	})
}
