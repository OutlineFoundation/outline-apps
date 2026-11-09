// +build windows

package blocker

import (
	"fmt"
	"math"
	"net"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/eycorsican/go-tun2socks/common/log"
)

func BlockOutsideDns(tunName string) error {
	var engine uintptr
	session := FWPM_SESSION0{
		Flags: FWPM_SESSION_FLAG_DYNAMIC,
	}
	err := FwpmEngineOpen0(nil, RPC_C_AUTHN_DEFAULT, nil, &session, unsafe.Pointer(&engine))
	if err != nil {
		return fmt.Errorf("failed to open engine: %v", err)
	}

	// Add a sublayer.
	key, err := windows.GenerateGUID()
	if err != nil {
		return fmt.Errorf("failed to generate GUID: %v", err)
	}
	displayData, err := CreateDisplayData("DnsBlocker", "Dns Blocker sublayer.")
	if err != nil {
		return fmt.Errorf("failed to create display data: %v", err)
	}
	sublayer := FWPM_SUBLAYER0{
		SubLayerKey: key,
		DisplayData: *displayData,
		Weight:      math.MaxUint16,
	}
	err = FwpmSubLayerAdd0(engine, &sublayer, 0)
	if err != nil {
		return fmt.Errorf("failed to add sublayer: %v", err)
	}

	var filterId uint64

	// Block all IPv6 traffic.
	blockV6FilterDisplayData, err := CreateDisplayData("DnsBlocker", "Block all IPv6 traffic.")
	if err != nil {
		return fmt.Errorf("failed to create block v6 filter filter display data: %v", err)
	}
	blockV6Filter := FWPM_FILTER0{
		DisplayData: *blockV6FilterDisplayData,
		SubLayerKey: key,
		LayerKey:    FWPM_LAYER_ALE_AUTH_CONNECT_V6,
		Action: FWPM_ACTION0{
			Type: FWP_ACTION_BLOCK,
		},
		Weight: FWP_VALUE0{
			Type:  FWP_UINT8,
			Value: uintptr(13),
		},
	}
	err = FwpmFilterAdd0(engine, &blockV6Filter, 0, &filterId)
	if err != nil {
		return fmt.Errorf("failed to add block v6 filter: %v", err)
	}
	log.Debugf("Added filter to block all IPv6 traffic")

	// Allow all IPv4 traffic to the TAP adapter.
	iface, err := net.InterfaceByName(tunName)
	if err != nil {
		return fmt.Errorf("fialed to get interface by name %v: %v", tunName, err)
	}
	tapWhitelistCondition := []FWPM_FILTER_CONDITION0{
		{
			FieldKey:  FWPM_CONDITION_LOCAL_INTERFACE_INDEX,
			MatchType: FWP_MATCH_EQUAL,
			ConditionValue: FWP_CONDITION_VALUE0{
				Type:  FWP_UINT32,
				Value: uintptr(uint32(iface.Index)),
			},
		},
	}
	tapWhitelistFilterDisplayData, err := CreateDisplayData("DnsBlocker", "Allow all traffic to the TAP device.")
	if err != nil {
		return fmt.Errorf("failed to create tap device whitelist filter display data: %v", err)
	}
	tapWhitelistFilter := FWPM_FILTER0{
		FilterCondition:     (*FWPM_FILTER_CONDITION0)(unsafe.Pointer(&tapWhitelistCondition[0])),
		NumFilterConditions: 1,
		DisplayData:         *tapWhitelistFilterDisplayData,
		SubLayerKey:         key,
		LayerKey:            FWPM_LAYER_ALE_AUTH_CONNECT_V4,
		Action: FWPM_ACTION0{
			Type: FWP_ACTION_PERMIT,
		},
		Weight: FWP_VALUE0{
			Type:  FWP_UINT8,
			Value: uintptr(11),
		},
	}
	err = FwpmFilterAdd0(engine, &tapWhitelistFilter, 0, &filterId)
	if err != nil {
		return fmt.Errorf("failed to add tap device whitelist filter: %v", err)
	}
	log.Debugf("Added filter to allow all IPv4 traffic to %v", tunName)

	// Block all UDP traffic targeting port 53.
	blockAllUDP53Condition := []FWPM_FILTER_CONDITION0{
		{
			FieldKey:  FWPM_CONDITION_IP_PROTOCOL,
			MatchType: FWP_MATCH_EQUAL,
			ConditionValue: FWP_CONDITION_VALUE0{
				Type:  FWP_UINT8,
				Value: uintptr(uint8(IPPROTO_UDP)),
			},
		}, {
			FieldKey:  FWPM_CONDITION_IP_REMOTE_PORT,
			MatchType: FWP_MATCH_EQUAL,
			ConditionValue: FWP_CONDITION_VALUE0{
				Type:  FWP_UINT16,
				Value: uintptr(uint16(53)),
			},
		},
	}
	blockAllUDP53FilterDisplayData, err := CreateDisplayData("DnsBlocker", "Block all UDP traffic targeting port 53")
	if err != nil {
		return fmt.Errorf("failed to create filter display data: %v", err)
	}
	blockAllUDP53Filter := FWPM_FILTER0{
		FilterCondition:     (*FWPM_FILTER_CONDITION0)(unsafe.Pointer(&blockAllUDP53Condition[0])),
		NumFilterConditions: 2,
		DisplayData:         *blockAllUDP53FilterDisplayData,
		SubLayerKey:         key,
		LayerKey:            FWPM_LAYER_ALE_AUTH_CONNECT_V4,
		Action: FWPM_ACTION0{
			Type: FWP_ACTION_BLOCK,
		},
		Weight: FWP_VALUE0{
			Type:  FWP_UINT8,
			Value: uintptr(10),
		},
	}
	err = FwpmFilterAdd0(engine, &blockAllUDP53Filter, 0, &filterId)
	if err != nil {
		return fmt.Errorf("failed to add filter: %v", err)
	}
	log.Debugf("Added filter to block all IPv4 UDP traffic targeting port 53")

	return nil
}
