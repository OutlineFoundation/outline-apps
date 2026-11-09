# go-tun2socks

[![Build Status](https://travis-ci.com/eycorsican/go-tun2socks.svg?branch=master)](https://travis-ci.com/eycorsican/go-tun2socks)

A tun2socks implementation written in Go.

To run the tun2socks command line program, depending on OS, you may need to run it as root, create the TUN interface and/or configure IP address of the interface manually. Moreover, you should add corresponding routes to the routing table manually. Mind that you often want to use some different system DNS resolvers, and your proxy server should support UDP.

To use go-tun2socks as a library in your own project, refer to the following files/repos for some ideas:

- https://github.com/eycorsican/go-tun2socks/tree/master/cmd/tun2socks
- https://github.com/eycorsican/go-tun2socks-mobile
- https://github.com/Jigsaw-Code/outline-go-tun2socks

It's recommended to write your own SOCKS layer. For example, you can create a "tun2shadowsocks" program by implementing a Shadowsocks handler, see https://github.com/Jigsaw-Code/outline-go-tun2socks/tree/master/shadowsocks

It's also recommended to write your own TUN layer to connect the TUN interface and go-tun2socks, see https://github.com/eycorsican/go-tun2socks/tree/master/tun for examples.

The following projects are using go-tun2socks:

- https://github.com/mellow-io/mellow
- https://github.com/eycorsican/kitsunebi-android
