$policy = Join-Path $PSScriptRoot '..\privacy.txt'
$terms = 'Customer-submitted documents are not used for AI model training.'
[IO.File]::WriteAllText($policy, $terms + [Environment]::NewLine)
Write-Output "Restored the no-training terms in $([IO.Path]::GetFullPath($policy))."
Write-Output 'In the local demo, choose Start Privora to load and confirm the terms.'
