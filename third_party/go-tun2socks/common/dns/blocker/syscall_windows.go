package blocker

import (
	"golang.org/x/sys/windows"
)

//go:generate go run golang.org/x/sys/windows/mkwinsyscall -output zsyscall_windows.go syscall_windows.go

//sys   FwpmEngineOpen0(serverName *uint16, authnService uint32, authIdentity *uintptr, session *FWPM_SESSION0, engineHandle unsafe.Pointer) (err error) [failretval!=0] = fwpuclnt.FwpmEngineOpen0

//sys   FwpmSubLayerAdd0(engineHandle uintptr, subLayer *FWPM_SUBLAYER0, sd uintptr) (err error) [failretval!=0] = fwpuclnt.FwpmSubLayerAdd0

//sys   FwpmFilterAdd0(engineHandle uintptr, filter *FWPM_FILTER0, sd uintptr, id *uint64) (err error) [failretval!=0] = fwpuclnt.FwpmFilterAdd0

const (
	RPC_C_AUTHN_DEFAULT       uint32 = 0xFFFFFFFF
	FWPM_SESSION_FLAG_DYNAMIC uint32 = 0x00000001
)

const (
	FWP_MATCH_EQUAL                  uint32 = 0
	FWP_MATCH_GREATER                       = (FWP_MATCH_EQUAL + 1)
	FWP_MATCH_LESS                          = (FWP_MATCH_GREATER + 1)
	FWP_MATCH_GREATER_OR_EQUAL              = (FWP_MATCH_LESS + 1)
	FWP_MATCH_LESS_OR_EQUAL                 = (FWP_MATCH_GREATER_OR_EQUAL + 1)
	FWP_MATCH_RANGE                         = (FWP_MATCH_LESS_OR_EQUAL + 1)
	FWP_MATCH_FLAGS_ALL_SET                 = (FWP_MATCH_RANGE + 1)
	FWP_MATCH_FLAGS_ANY_SET                 = (FWP_MATCH_FLAGS_ALL_SET + 1)
	FWP_MATCH_FLAGS_NONE_SET                = (FWP_MATCH_FLAGS_ANY_SET + 1)
	FWP_MATCH_EQUAL_CASE_INSENSITIVE        = (FWP_MATCH_FLAGS_NONE_SET + 1)
	FWP_MATCH_NOT_EQUAL                     = (FWP_MATCH_EQUAL_CASE_INSENSITIVE + 1)
	FWP_MATCH_PREFIX                        = (FWP_MATCH_NOT_EQUAL + 1)
	FWP_MATCH_NOT_PREFIX                    = (FWP_MATCH_PREFIX + 1)
	FWP_MATCH_TYPE_MAX                      = (FWP_MATCH_NOT_PREFIX + 1)
)

const (
	FWP_EMPTY                         uint32 = 0
	FWP_UINT8                                = (FWP_EMPTY + 1)
	FWP_UINT16                               = (FWP_UINT8 + 1)
	FWP_UINT32                               = (FWP_UINT16 + 1)
	FWP_UINT64                               = (FWP_UINT32 + 1)
	FWP_INT8                                 = (FWP_UINT64 + 1)
	FWP_INT16                                = (FWP_INT8 + 1)
	FWP_INT32                                = (FWP_INT16 + 1)
	FWP_INT64                                = (FWP_INT32 + 1)
	FWP_FLOAT                                = (FWP_INT64 + 1)
	FWP_DOUBLE                               = (FWP_FLOAT + 1)
	FWP_BYTE_ARRAY16_TYPE                    = (FWP_DOUBLE + 1)
	FWP_BYTE_BLOB_TYPE                       = (FWP_BYTE_ARRAY16_TYPE + 1)
	FWP_SID                                  = (FWP_BYTE_BLOB_TYPE + 1)
	FWP_SECURITY_DESCRIPTOR_TYPE             = (FWP_SID + 1)
	FWP_TOKEN_INFORMATION_TYPE               = (FWP_SECURITY_DESCRIPTOR_TYPE + 1)
	FWP_TOKEN_ACCESS_INFORMATION_TYPE        = (FWP_TOKEN_INFORMATION_TYPE + 1)
	FWP_UNICODE_STRING_TYPE                  = (FWP_TOKEN_ACCESS_INFORMATION_TYPE + 1)
	FWP_BYTE_ARRAY6_TYPE                     = (FWP_UNICODE_STRING_TYPE + 1)
	FWP_BITMAP_INDEX_TYPE                    = (FWP_BYTE_ARRAY6_TYPE + 1)
	FWP_BITMAP_ARRAY64_TYPE                  = (FWP_BITMAP_INDEX_TYPE + 1)
	FWP_SINGLE_DATA_TYPE_MAX                 = 0xff
	FWP_V4_ADDR_MASK                         = (FWP_SINGLE_DATA_TYPE_MAX + 1)
	FWP_V6_ADDR_MASK                         = (FWP_V4_ADDR_MASK + 1)
	FWP_RANGE_TYPE                           = (FWP_V6_ADDR_MASK + 1)
	FWP_DATA_TYPE_MAX                        = (FWP_RANGE_TYPE + 1)
)

var FWPM_CONDITION_IP_PROTOCOL = windows.GUID{
	Data1: 0x3971ef2b,
	Data2: 0x623e,
	Data3: 0x4f9a,
	Data4: [8]byte{0x8c, 0xb1, 0x6e, 0x79, 0xb8, 0x06, 0xb9, 0xa7},
}

var FWPM_CONDITION_IP_REMOTE_PORT = windows.GUID{
	Data1: 0xc35a604d,
	Data2: 0xd22b,
	Data3: 0x4e1a,
	Data4: [8]byte{0x91, 0xb4, 0x68, 0xf6, 0x74, 0xee, 0x67, 0x4b},
}

var FWPM_LAYER_ALE_AUTH_CONNECT_V4 = windows.GUID{
	Data1: 0xc38d57d1,
	Data2: 0x05a7,
	Data3: 0x4c33,
	Data4: [8]byte{0x90, 0x4f, 0x7f, 0xbc, 0xee, 0xe6, 0x0e, 0x82},
}

var FWPM_CONDITION_LOCAL_INTERFACE_INDEX = windows.GUID{
	Data1: 0x667fd755,
	Data2: 0xd695,
	Data3: 0x434a,
	Data4: [8]byte{0x8a, 0xf5, 0xd3, 0x83, 0x5a, 0x12, 0x59, 0xbc},
}

var FWPM_LAYER_ALE_AUTH_CONNECT_V6 = windows.GUID{
	Data1: 0x4a72393b,
	Data2: 0x319f,
	Data3: 0x44bc,
	Data4: [8]byte{0x84, 0xc3, 0xba, 0x54, 0xdc, 0xb3, 0xb6, 0xb4},
}

const (
	IPPROTO_UDP uint32 = 17
)

const (
	FWP_ACTION_FLAG_TERMINATING uint32 = 0x00001000
	FWP_ACTION_BLOCK            uint32 = (0x00000001 | FWP_ACTION_FLAG_TERMINATING)
	FWP_ACTION_PERMIT           uint32 = (0x00000002 | FWP_ACTION_FLAG_TERMINATING)
)

const (
	FWPM_FILTER_FLAG_NONE                                = 0x00000000
	FWPM_FILTER_FLAG_PERSISTENT                          = 0x00000001
	FWPM_FILTER_FLAG_BOOTTIME                            = 0x00000002
	FWPM_FILTER_FLAG_HAS_PROVIDER_CONTEXT                = 0x00000004
	FWPM_FILTER_FLAG_CLEAR_ACTION_RIGHT                  = 0x00000008
	FWPM_FILTER_FLAG_PERMIT_IF_CALLOUT_UNREGISTERED      = 0x00000010
	FWPM_FILTER_FLAG_DISABLED                            = 0x00000020
	FWPM_FILTER_FLAG_INDEXED                             = 0x00000040
	FWPM_FILTER_FLAG_HAS_SECURITY_REALM_PROVIDER_CONTEXT = 0x00000080
	FWPM_FILTER_FLAG_SYSTEMOS_ONLY                       = 0x00000100
	FWPM_FILTER_FLAG_GAMEOS_ONLY                         = 0x00000200
	FWPM_FILTER_FLAG_SILENT_MODE                         = 0x00000400
	FWPM_FILTER_FLAG_IPSEC_NO_ACQUIRE_INITIATE           = 0x00000800
)

type FWPM_DISPLAY_DATA0 struct {
	Name        *uint16
	Description *uint16
}

type FWPM_SESSION0 struct {
	SessionKey           windows.GUID
	DisplayData          FWPM_DISPLAY_DATA0
	Flags                uint32
	TxnWaitTimeoutInMSec uint32
	ProcessId            uint32
	Sid                  *windows.SID
	Username             *uint16
	KernelMode           int32
}

type FWP_BYTE_BLOB struct {
	size uint32
	data *uint8
}

type FWPM_SUBLAYER0 struct {
	SubLayerKey  windows.GUID
	DisplayData  FWPM_DISPLAY_DATA0
	Flags        uint32
	ProviderKey  *windows.GUID
	ProviderData FWP_BYTE_BLOB
	Weight       uint16
}

type FWP_VALUE0 struct {
	Type  uint32
	Value uintptr
}

type FWP_CONDITION_VALUE0 FWP_VALUE0

type FWPM_FILTER_CONDITION0 struct {
	FieldKey       windows.GUID
	MatchType      uint32
	ConditionValue FWP_CONDITION_VALUE0
}

type FWPM_ACTION0 struct {
	Type  uint32
	Value windows.GUID
}

type FWPM_FILTER0 struct {
	FilterKey           windows.GUID
	DisplayData         FWPM_DISPLAY_DATA0
	Flags               uint32
	ProviderKey         *windows.GUID
	ProviderData        FWP_BYTE_BLOB
	LayerKey            windows.GUID
	SubLayerKey         windows.GUID
	Weight              FWP_VALUE0
	NumFilterConditions uint32
	FilterCondition     *FWPM_FILTER_CONDITION0
	Action              FWPM_ACTION0
	Context             windows.GUID
	Reserved            *windows.GUID
	FilterId            uint64
	EffectiveWeight     FWP_VALUE0
}

func CreateDisplayData(name, description string) (*FWPM_DISPLAY_DATA0, error) {
	namePtr, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return nil, err
	}

	descriptionPtr, err := windows.UTF16PtrFromString(description)
	if err != nil {
		return nil, err
	}

	return &FWPM_DISPLAY_DATA0{
		Name:        namePtr,
		Description: descriptionPtr,
	}, nil
}
