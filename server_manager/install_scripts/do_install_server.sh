#!/bin/bash
#
# Copyright 2018 The Outline Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Script to install Shadowbox on a DigitalOcean droplet

# You must set the following environment variables:
# DO_ACCESS_TOKEN: DigitalOcean access token, with read and write privileges.

# You may set the following environment variables, overriding their defaults:
# SB_IMAGE: Shadowbox Docker image to install, e.g. quay.io/outline/shadowbox:nightly
# SB_API_PORT: The port number of the management API.
# SENTRY_API_URL: Url to post Sentry report to on error.
# WATCHTOWER_REFRESH_SECONDS: refresh interval in seconds to check for updates,
#     defaults to 3600.

set -euo pipefail

# Re-enable password login, since DigitalOcean disables it when we create a server
# with a SSH key.
sed -i 's/PasswordAuthentication no/# PasswordAuthentication no  # Commented out by the Outline installer/' /etc/ssh/sshd_config

export SHADOWBOX_DIR="${SHADOWBOX_DIR:-${HOME:-/root}/shadowbox}"
mkdir -p "${SHADOWBOX_DIR}"

# Save output for debugging
exec &> "${SHADOWBOX_DIR}/install-shadowbox-output"

# Initialize sentry log file.
export SENTRY_LOG_FILE="${SHADOWBOX_DIR}/sentry-log-file.txt"
true > "${SENTRY_LOG_FILE}"
function log_for_sentry() {
  echo "[$(date "+%Y-%m-%d@%H:%M:%S")]" "do_install_server.sh" "$@" >> "${SENTRY_LOG_FILE}"
}
function post_sentry_report() {
  if [[ -n "${SENTRY_API_URL}" ]]; then
    # Get JSON formatted string.  This command replaces newlines with literal '\n'
    # but otherwise assumes that there are no other characters to escape for JSON.
    # If we need better escaping, we can install the jq command line tool.
    local -ir SENTRY_PAYLOAD_BYTE_LIMIT=8000
    local SENTRY_PAYLOAD
    SENTRY_PAYLOAD="{\"message\": \"Install error:\n$(awk '{printf "%s\\n", $0}' < "${SENTRY_LOG_FILE}" | tail --bytes "${SENTRY_PAYLOAD_BYTE_LIMIT}")\"}"
    # See Sentry documentation at:
    # https://media.readthedocs.org/pdf/sentry/7.1.0/sentry.pdf
    curl -sSL "${SENTRY_API_URL}" -H "Origin: shadowbox" --data-binary "${SENTRY_PAYLOAD}"
  fi
}

# For backward-compatibility:
readonly DO_ACCESS_TOKEN="${DO_ACCESS_TOKEN:-ACCESS_TOKEN}"

if [[ -z "${DO_ACCESS_TOKEN}" ]]; then
  echo "Access token must be supplied"
  exit 1
fi

# DigitalOcean's Metadata API base url.
# This URL only supports HTTP (not HTTPS) requests, however it is a local link
# address so not at risk for man-in-the-middle attacks or eavesdropping.
# More detail at https://serverfault.com/questions/427018/what-is-this-ip-address-169-254-169-254
readonly DO_METADATA_URL="http://169.254.169.254/metadata/v1"

function cloud::public_ip() {
  curl -sSL "${DO_METADATA_URL}/interfaces/public/0/ipv4/address"
}

# Applies a tag to this droplet.
function cloud::add_tag() {
  local -r tag="$1"
  local -ar base_flags=(-X POST -H 'Content-Type: application/json' \
                        -H "Authorization: Bearer ${DO_ACCESS_TOKEN}")
  local -r TAGS_URL='https://api.digitalocean.com/v2/tags'
  # Create the tag
  curl -sSL "${base_flags[@]}" -d "{\"name\":\"${tag}\"}" "${TAGS_URL}"
  local droplet_id
  droplet_id="$(curl -sSL "${DO_METADATA_URL}/id")"
  printf -v droplet_obj '
{
  "resources": [{
    "resource_id": "%s",
    "resource_type": "droplet"
  }]
}' "${droplet_id}"
  # Link the tag to this droplet
  curl -sSL "${base_flags[@]}" -d "${droplet_obj}" "${TAGS_URL}/${tag}/resources"
}

# Adds a key-value tag to the droplet.
# Takes the key as the only argument and reads the value from stdin.
# add_kv_tag() converts the input value to hex, because (1) DigitalOcean
# tags may only contain letters, numbers, : - and _, and (2) there is
# currently a bug that makes tags case-insensitive, so we can't use base64.
function cloud::add_kv_tag() {
  local -r key="$1"
  local value
  value="$(xxd -p -c 255)"
  cloud::add_tag "kv:${key}:${value}"
}

# Adds a key-value tag where the value is already hex-encoded.
function cloud::add_encoded_kv_tag() {
  local -r key="$1"
  local value
  read -r value
  cloud::add_tag "kv:${key}:${value}"
}

echo "true" | cloud::add_encoded_kv_tag "install-started"

log_for_sentry "Starting install"

# DigitalOcean's docker image comes with ufw enabled by default, disable so when
# can serve the shadowbox manager and instances on arbitrary high number ports.
log_for_sentry "Disabling ufw"
ufw disable

# Recent DigitalOcean Ubuntu droplets have unattended-upgrades configured from
# the outset but we want to enable automatic rebooting so that critical updates
# are applied without the Outline user's intervention.
readonly UNATTENDED_UPGRADES_CONFIG='/etc/apt/apt.conf.d/50unattended-upgrades'
if [[ -f "${UNATTENDED_UPGRADES_CONFIG}" ]]; then
  log_for_sentry "Configuring auto-updates"
  cat >> "${UNATTENDED_UPGRADES_CONFIG}" << EOF

// Enabled by Outline manager installer.
Unattended-Upgrade::Automatic-Reboot "true";
EOF
fi

# Enable BBR.
# Recent DigitalOcean one-click images are based on Ubuntu 18 and have kernel 4.15+.
log_for_sentry "Enabling BBR"
cat >> /etc/sysctl.conf << EOF

# Added by Outline.
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
EOF
sysctl -p

log_for_sentry "Getting SB_PUBLIC_IP"
SB_PUBLIC_IP="$(cloud::public_ip)"
export SB_PUBLIC_IP

log_for_sentry "Initializing ACCESS_CONFIG"
export ACCESS_CONFIG="${SHADOWBOX_DIR}/access.txt"
true > "${ACCESS_CONFIG}"

# Set trap which publishes an error tag and sentry report only if there is an error.
function finish {
  local -ir INSTALL_SERVER_EXIT_CODE=$?
  log_for_sentry "In EXIT trap, exit code ${INSTALL_SERVER_EXIT_CODE}"
  if ! ( grep --quiet apiUrl "${ACCESS_CONFIG}" && grep --quiet certSha256 "${ACCESS_CONFIG}" ); then
    echo "INSTALL_SCRIPT_FAILED: ${INSTALL_SERVER_EXIT_CODE}" | cloud::add_kv_tag "install-error"
    # Post error report to sentry.
    post_sentry_report
  fi
}
trap finish EXIT

# Run install script asynchronously, so tags can be written as soon as they are ready.
log_for_sentry "Running install_server.sh"
./install_server.sh&
declare -ir install_pid=$!

# Save tags for access information.
log_for_sentry "Reading tags from ACCESS_CONFIG"
tail -f "${ACCESS_CONFIG}" "--pid=${install_pid}" | while IFS=: read -r key value; do
  case "${key}" in
    certSha256)
      # Bypass encoding
      log_for_sentry "Writing certSha256 tag"
      echo "${value}" | cloud::add_encoded_kv_tag "${key}"
      ;;
    apiUrl)
      log_for_sentry "Writing apiUrl tag"
      echo -n "${value}" | cloud::add_kv_tag "${key}"
      ;;
  esac
done

# Wait for install script to finish, so that if there is any error in install_server.sh,
# the finish trap in this file will be able to access its error code.
wait "${install_pid}"

# We could install the agents below in the create droplet request, but they add
# over a minute of delay to the droplet readiness. Instead, we do it here.
# Since the server manager looks only for the tags created in the previous
# step, this does not slow down server creation.

# Install the DigitalOcean Metrics Agent, for improved monitoring:
# https://docs.digitalocean.com/products/monitoring/how-to/install-agent/
curl -sSL https://repos.insights.digitalocean.com/install.sh | bash

# Install the DigitalOcean Droplet Agent, for web console integration:
# https://docs.digitalocean.com/products/droplets/how-to/manage-agent/
curl -sSL https://repos-droplet.digitalocean.com/install.sh | bash
