// Copyright 2018 The Outline Authors
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

#include <memory>
#include <optional>
#include <string>

#include <sys/types.h>

#include <boost/asio/awaitable.hpp>
#include <boost/asio/local/stream_protocol.hpp>
#include <boost/property_tree/ptree.hpp>

#include "outline_error.h"
#include "outline_proxy_controller.h"

#if defined(BOOST_ASIO_HAS_LOCAL_SOCKETS)

namespace outline {

/**
 * @brief A session that serves requests from a specific Outline client, and
 *        configures the system accordingly with root privileges.
 */
class OutlineClientSession
    : public std::enable_shared_from_this<OutlineClientSession> {
public:
  /**
   * @brief Construct a new OutlineClientSession object with a specific channel
   * as well as the underlying worker `outline_proxy_controller`.
   *
   * @param channel A socket that the session will be reading from and writing
   * to.
   * @param outline_proxy_controller A worker which can be used to configure the
   * system.
   */
  OutlineClientSession(
      boost::asio::local::stream_protocol::socket &&channel,
      std::shared_ptr<OutlineProxyController> outline_proxy_controller);

  ~OutlineClientSession();

public:
  /**
   * @brief Start a session for a specific Outline client asynchronously.
   *
   * @return boost::asio::awaitable<void> A co_awaitable C++20 coroutine.
   */
  boost::asio::awaitable<void> Start();

private:
  /**
   * @brief Start serving requests from a specific Outline client
   * asynchronously.
   */
  boost::asio::awaitable<void> ServeClientCommands();

  /**
   * @brief Start monitoring network changes and update connection status
   * asynchronously.
   */
  boost::asio::awaitable<void> MonitorNetworkChanges();

private:
  /** @brief `TunnelStatus` in "web/app/tunnel.ts" */
  enum class ConnectionState : int {
    kConnected = 0,
    kDisconnected = 1,
    kReconnecting = 2,
  };

  /** @brief Execution result of a client request command. */
  struct CommandResult {
    int status_code;
    std::optional<std::string> error_message;
    std::string action;
    std::optional<ConnectionState> connection_state;
  };

  /** @brief Factory method to create a success result. */
  static CommandResult SucceededResult(const std::string &action);

  /** @brief Factory method to create a failed result. */
  static CommandResult ErrorResult(ErrorCode, const std::string &err_msg,
                                   const std::string &action);

  /** @brief Factory method to create a connection state changed notification.
   */
  static CommandResult ConnectionStateChangedResult(ConnectionState state);

private:
  /**
   * @brief interprets the request from the client app and act upon them.
   *
   * @param request The Json object sent by Outline client.
   * @return CommandResult The result of the command execution.
   */
  CommandResult RunClientCommand(const boost::property_tree::ptree &request);

private:
  /**
   * @brief Send a specific response to Outline client.
   */
  boost::asio::awaitable<void> SendResponse(const CommandResult &response);

private:
  boost::asio::local::stream_protocol::socket channel_;
  std::shared_ptr<OutlineProxyController> outline_controller_;
};

/**
 * @brief A server that accepts requests from Outline client. Each request will
 *        be served by a dedicated `OutlineClientSession` asynchronously.
 */
class OutlineControllerServer {
public:
  /**
   * @brief Construct a new OutlineControllerServer object with a specific
   *        Unix socket name and the owner uid who is running Outline.
   *        Need to call `start()` to start accepting requests.
   *
   * @param unix_socket The Unix socket name that we will be listening.
   * @param owning_user The owner uid of the Unix socket (typically it is the
   *                    user who installs Outline).
   */
  OutlineControllerServer(const std::string &unix_socket, uid_t owning_user);

public:
  /**
   * @brief Start listening to the Outline Unix socket asynchronously.
   *
   * @return boost::asio::awaitable<void> A co_awaitable C++20 coroutine.
   */
  boost::asio::awaitable<void> Start();

private:
  std::shared_ptr<OutlineProxyController> outline_controller_;
  std::string unix_socket_name_;
  uid_t socket_owner_id_;
};

} // namespace outline
#else // defined(BOOST_ASIO_HAS_LOCAL_SOCKETS)
#error Local sockets not available on this platform.
#endif // defined(BOOST_ASIO_HAS_LOCAL_SOCKETS)
