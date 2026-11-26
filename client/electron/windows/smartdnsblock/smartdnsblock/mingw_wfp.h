// Copyright 2026 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

#pragma once

#include <fwpmu.h>

// The MinGW-w64 headers in Zig 0.17.1 omit these Windows SDK definitions.
// fwpmu.h aliases FWPM_CONDITION_LOCAL_INTERFACE_INDEX to FWPM_CONDITION_INTERFACE_INDEX.
// https://github.com/microsoft/win32metadata/blob/a40ed3186943620f304649a077b78f8271034736/generation/WinSDK/RecompiledIdlHeaders/um/fwpmu.h
#ifndef FWPM_CONDITION_LOCAL_INTERFACE_INDEX
constexpr GUID FWPM_CONDITION_LOCAL_INTERFACE_INDEX =
    {0x667fd755, 0xd695, 0x434a, {0x8a, 0xf5, 0xd3, 0x83, 0x5a, 0x12, 0x59, 0xbc}};
constexpr GUID FWPM_CONDITION_IP_PROTOCOL =
    {0x3971ef2b, 0x623e, 0x4f9a, {0x8c, 0xb1, 0x6e, 0x79, 0xb8, 0x06, 0xb9, 0xa7}};
constexpr GUID FWPM_CONDITION_IP_REMOTE_PORT =
    {0xc35a604d, 0xd22b, 0x4e1a, {0x91, 0xb4, 0x68, 0xf6, 0x74, 0xee, 0x67, 0x4b}};
constexpr GUID FWPM_LAYER_ALE_AUTH_CONNECT_V4 =
    {0xc38d57d1, 0x05a7, 0x4c33, {0x90, 0x4f, 0x7f, 0xbc, 0xee, 0xe6, 0x0e, 0x82}};
#endif

// https://github.com/microsoft/win32metadata/blob/a40ed3186943620f304649a077b78f8271034736/generation/WinSDK/RecompiledIdlHeaders/shared/fwpmtypes.h
#ifndef FWPM_SESSION_FLAG_DYNAMIC
#define FWPM_SESSION_FLAG_DYNAMIC 0x00000001
#endif
