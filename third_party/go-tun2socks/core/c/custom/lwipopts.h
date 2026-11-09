/**
 * @file lwipopts.h
 * @author Ambroz Bizjak <ambrop7@gmail.com>
 * 
 * @section LICENSE
 * 
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the author nor the
 *    names of its contributors may be used to endorse or promote products
 *    derived from this software without specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#ifndef LWIP_CUSTOM_LWIPOPTS_H
#define LWIP_CUSTOM_LWIPOPTS_H

// enable tun2socks logic
#define TUN2SOCKS 1

#define NO_SYS 1
#define LWIP_TIMERS 1

#define IP_DEFAULT_TTL 64
#define LWIP_ARP 0
#define ARP_QUEUEING 0
#define IP_FORWARD 0
#define LWIP_ICMP 1
#define LWIP_RAW 1
#define LWIP_DHCP 0
#define LWIP_AUTOIP 0
#define LWIP_SNMP 0
#define LWIP_IGMP 0
#define LWIP_DNS 0
#define LWIP_UDP 1
#define LWIP_UDPLITE 0
#define LWIP_TCP 1
#define LWIP_CALLBACK_API 1
#define LWIP_NETIF_API 0
#define LWIP_NETIF_LOOPBACK 0
#define LWIP_HAVE_LOOPIF 1
#define LWIP_HAVE_SLIPIF 0
#define LWIP_NETCONN 0
#define LWIP_SOCKET 0
#define PPP_SUPPORT 0
#define LWIP_IPV6 1
#define LWIP_IPV6_MLD 0
#define LWIP_IPV6_AUTOCONFIG 1

// disable checksum checks
#define CHECKSUM_CHECK_IP 0
#define CHECKSUM_CHECK_UDP 0
#define CHECKSUM_CHECK_TCP 0
#define CHECKSUM_CHECK_ICMP 0
#define CHECKSUM_CHECK_ICMP6 0

#define LWIP_CHECKSUM_ON_COPY 1

#define MEMP_NUM_TCP_PCB_LISTEN 1
#define MEMP_NUM_TCP_PCB 16
#define MEMP_NUM_UDP_PCB 1

/*
#define TCP_LISTEN_BACKLOG 1
#define TCP_DEFAULT_LISTEN_BACKLOG 0xff
#define LWIP_TCP_TIMESTAMPS 1
*/

#define TCP_MSS 1460
#define TCP_WND 32 * 1024
#define TCP_SND_BUF (TCP_WND)

#define MEM_LIBC_MALLOC 1
#define MEMP_MEM_MALLOC 1
#define MEM_SIZE 128 * 1024

#define SYS_LIGHTWEIGHT_PROT 0
#define LWIP_DONT_PROVIDE_BYTEORDER_FUNCTIONS

// needed on 64-bit systems, enable it always so that the same configuration
// is used regardless of the platform
#define IPV6_FRAG_COPYHEADER 1

#define LWIP_DEBUG 0
#define LWIP_DBG_TYPES_ON LWIP_DBG_OFF
#define INET_DEBUG LWIP_DBG_ON
#define IP_DEBUG LWIP_DBG_ON
#define RAW_DEBUG LWIP_DBG_ON
#define SYS_DEBUG LWIP_DBG_ON
#define NETIF_DEBUG LWIP_DBG_ON
#define TCP_DEBUG LWIP_DBG_ON
#define UDP_DEBUG LWIP_DBG_ON
#define TCP_INPUT_DEBUG LWIP_DBG_ON
#define TCP_OUTPUT_DEBUG LWIP_DBG_ON
#define TCPIP_DEBUG LWIP_DBG_ON
#define IP6_DEBUG LWIP_DBG_ON

#define LWIP_STATS 0
#define LWIP_STATS_DISPLAY 0
#define LWIP_PERF 0

#endif
