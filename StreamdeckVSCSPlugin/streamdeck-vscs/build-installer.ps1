param(
	[string]$Destination = "$env:USERPROFILE\\Documents\\ForInstaller"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Push-Location $scriptDir
try {
	if (-not (Test-Path $Destination)) {
		New-Item -ItemType Directory -Path $Destination -Force | Out-Null
	}

	if (-not (Test-Path "$scriptDir/node_modules")) {
		Write-Host "node_modules missing; installing dependencies..."
		npm install | Write-Host
	}

	Write-Host "Building and packaging Stream Deck plugin..."
	npm run package

	$package = Get-ChildItem -Path $scriptDir -Filter *.streamDeckPlugin | Sort-Object LastWriteTime -Descending | Select-Object -First 1
	if (-not $package) {
		throw "Package file (.streamDeckPlugin) not found."
	}

	$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
	$destinationName = "$($package.BaseName)_$timestamp$($package.Extension)"
	$destinationPath = Join-Path $Destination $destinationName

	Copy-Item -Path $package.FullName -Destination $destinationPath -Force
	Write-Host "Installer copied to $destinationPath"
}
finally {
	Pop-Location
}
