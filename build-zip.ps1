<#
    Packages an extension folder into an upload-ready zip.

    Why this does not use Compress-Archive or ZipFile::CreateFromDirectory:
    on Windows PowerShell 5.1 (.NET Framework) both write the OS separator
    into the entry names, producing "sunburst\style.css". The ZIP spec
    (APPNOTE 4.4.17.1) requires forward slashes, and an unzip implementation
    that follows it yields one oddly named file instead of a folder, so the
    imported extension fails to load. Entries are therefore written by hand.

    Usage:  powershell -ExecutionPolicy Bypass -File build-zip.ps1 sunburst
            powershell -ExecutionPolicy Bypass -File build-zip.ps1        # all
#>
param([string[]] $Name)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $Name -or $Name.Count -eq 0) {
    $Name = Get-ChildItem -Path $root -Directory |
        Where-Object { Test-Path (Join-Path $_.FullName "$($_.Name).qext") } |
        ForEach-Object { $_.Name }
}

foreach ($n in $Name) {
    $src = Join-Path $root $n
    $zip = Join-Path $root "$n.zip"

    if (-not (Test-Path $src)) { Write-Error "No such folder: $src"; continue }
    if (-not (Test-Path (Join-Path $src "$n.qext"))) {
        Write-Error "$n has no $n.qext; that name must match the folder"; continue
    }

    if (Test-Path $zip) { Remove-Item $zip -Force }

    $stream  = [System.IO.File]::Open($zip, [System.IO.FileMode]::CreateNew)
    $archive = New-Object System.IO.Compression.ZipArchive(
        $stream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $prefix = (Resolve-Path $src).Path.TrimEnd('\') + '\'
        foreach ($file in Get-ChildItem -Path $src -File -Recurse) {
            # entry name relative to the extension folder's parent, forward slashes
            $rel = $file.FullName.Substring($prefix.Length) -replace '\\', '/'
            $entry = $archive.CreateEntry("$n/$rel",
                [System.IO.Compression.CompressionLevel]::Optimal)
            $out = $entry.Open()
            $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
            $out.Write($bytes, 0, $bytes.Length)
            $out.Dispose()
        }
    } finally {
        $archive.Dispose()
        $stream.Dispose()
    }

    # read the entries back so a bad package can never ship unnoticed
    $z = [System.IO.Compression.ZipFile]::OpenRead($zip)
    $bad = @($z.Entries | Where-Object { $_.FullName -like '*\*' })
    $hasQext = @($z.Entries | Where-Object { $_.FullName -eq "$n/$n.qext" }).Count -eq 1
    $count = $z.Entries.Count
    $z.Dispose()

    if ($bad.Count -gt 0) {
        Remove-Item $zip -Force
        Write-Error "$n.zip had backslash entries and was discarded"; continue
    }
    if (-not $hasQext) {
        Remove-Item $zip -Force
        Write-Error "$n.zip is missing $n/$n.qext and was discarded"; continue
    }
    "{0,-22} {1,2} files {2,8:N0} bytes  OK" -f "$n.zip", $count, (Get-Item $zip).Length
}
