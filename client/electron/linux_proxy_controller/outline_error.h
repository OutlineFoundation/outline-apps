// Copyright 2022 The Outline Authors
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
//
// This file contains the C++11 standard conforming implementation of
// all errors used by outline.

#pragma once

#include <system_error>

namespace outline {

/**
 * @brief The standard error code constants used by outline.
 * @remarks The codes are copied from "/web/model/errors.ts".
 */
enum class ErrorCode {
  kOk = 0,
  kUnexpected = 1,
  kVpnPermissionDenied = 2,
  kInvalidServerCredentials = 3,
  kUdpRelayNotEnabled = 4,
  kServerUnreachable = 5,
  kVpnStartFailure = 6,
  kInvalidServerConfiguration = 7,
  kClientStartFailure = 8,
  kConfigureSystemProxyFailure = 9,
  kAdminPermissionDenied = 10,
  kUnsupportedRoutingTable = 11,
  kSystemMisconfigured = 12,
};

/**
 * @brief Get a singleton instance representing outline error category.
 *
 * @return const std::error_category& The outline error category.
 */
const std::error_category &OutlineErrorCategory();

/**
 * @brief Construct an error_code from outline_error.
 * @remarks Can declare in the same namespace thanks to Koenig lookup.
 */
std::error_code make_error_code(ErrorCode);

} // namespace outline

namespace std {
/**
 * @brief Register to STL for implicit conversion to error_code.
 */
template <> struct is_error_code_enum<outline::ErrorCode> : true_type {};
} // namespace std
