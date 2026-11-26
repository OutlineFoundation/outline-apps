# Copyright 2026 The Outline Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

param(
    [Parameter(Mandatory)][ValidateSet('ia32', 'arm64')][string]$Architecture,
    [Parameter(Mandatory)][string]$ArtifactDirectory
)

$ErrorActionPreference = 'Stop'
if (Get-Service -Name OutlineService -ErrorAction SilentlyContinue) {
    throw 'OutlineService is already installed. Run this test on a fresh Windows VM.'
}

$installer = Join-Path $ArtifactDirectory "Outline-Client-$Architecture.exe"
$process = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
if ($process.ExitCode -ne 0) {
    throw "Outline installer exited with code $($process.ExitCode)"
}

$service = Get-Service -Name OutlineService
$service.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
Write-Host 'The installer started OutlineService.'

$installedService = Get-CimInstance Win32_Service -Filter "Name='OutlineService'"
$installDir = Split-Path -Parent ($installedService.PathName.Trim('"'))
$expectedHashes = Get-Content -LiteralPath (Join-Path $ArtifactDirectory 'helpers.sha256')
foreach ($name in 'OutlineService.exe', 'smartdnsblock.exe') {
    $hash = (Get-FileHash -LiteralPath (Join-Path $installDir $name) -Algorithm SHA256).Hash
    if ("$hash  $name" -notin $expectedHashes) {
        throw "Installed $name differs from the Linux build"
    }
}

# An arm64 runner can also install and run the ia32 package. Check the installed PE headers.
if ($Architecture -eq 'arm64') {
    $machine = 'Arm64'
    $goArch = 'arm64'
} else {
    $machine = 'I386'
    $goArch = '386'
}
$backendDir = "resources/app.asar.unpacked/output/client/windows-$goArch"
foreach ($name in 'Outline.exe', 'OutlineService.exe', 'smartdnsblock.exe', "$backendDir/backend.dll", "$backendDir/tun2socks.exe") {
    $path = Join-Path $installDir $name
    $reader = [System.Reflection.PortableExecutable.PEReader]::new([IO.File]::OpenRead($path))
    try {
        $actualMachine = $reader.PEHeaders.CoffHeader.Machine
        if ($actualMachine -ne $machine) {
            throw "Expected $machine for installed $name, found $actualMachine"
        }
    } finally {
        $reader.Dispose()
    }
}

# A read-only connection checks the service listener without sending a routing request.
$pipe = [IO.Pipes.NamedPipeClientStream]::new('.', 'OutlineServicePipe', [IO.Pipes.PipeDirection]::In)
try {
    $pipe.Connect(15000)
    Write-Host 'Opened \\.\pipe\OutlineServicePipe.'
} finally {
    $pipe.Dispose()
}
