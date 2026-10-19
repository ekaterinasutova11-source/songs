param([string]$ConfigPath = 'D:\ffmpeg-gui\songs-site\secrets\selectel-2026-10-20\backup-client.json')
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$mutex = [System.Threading.Mutex]::new($false, 'Local\SongsSelectelBackup')
if (-not $mutex.WaitOne(0)) { exit 0 }
$logPath = Join-Path $config.backupRoot 'last-run.log'
Start-Transcript -Path $logPath -Force | Out-Null
try {
    $env:RESTIC_CACHE_DIR = Join-Path $config.backupRoot 'cache'
    $repo = Join-Path $config.backupRoot 'repository'
    $sshCommand = 'C:/Windows/System32/OpenSSH/ssh.exe -i ' + $config.sshKey.Replace('\','/') + ' -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=yes -s root@135.106.183.211 sftp'
    $resticOptions = @('-r', $repo, '--password-file', $config.localPassword, '-o', ('sftp.command=' + $sshCommand))
    $fromOptions = @('--from-repo', 'sftp:root@135.106.183.211:/var/backups/songs-restic', '--from-password-file', $config.sourcePassword)
    if (-not (Test-Path -LiteralPath (Join-Path $repo 'config'))) {
        & $config.restic @resticOptions init @fromOptions --copy-chunker-params
        if ($LASTEXITCODE -ne 0) { throw 'Cannot initialize independent backup' }
    }
    & $config.restic @resticOptions copy @fromOptions --tag songs
    if ($LASTEXITCODE -ne 0) { throw 'Cannot download server snapshots' }
    & $config.restic @resticOptions check
    if ($LASTEXITCODE -ne 0) { throw 'Independent backup integrity check failed' }
    & $config.restic @resticOptions forget --tag songs --keep-daily 14 --keep-weekly 8 --keep-monthly 6
    if ($LASTEXITCODE -ne 0) { throw 'Backup retention failed' }
    [DateTime]::UtcNow.ToString('o') | Set-Content -LiteralPath (Join-Path $config.backupRoot 'last-success.txt')
} finally {
    Stop-Transcript | Out-Null
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
