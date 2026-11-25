$policy = Join-Path $PSScriptRoot '..\privacy.txt'
$terms = 'Customer-submitted documents are not used for AI model training.'
[IO.File]::WriteAllText($policy, $terms + [Environment]::NewLine)
Write-Output "Restored the no-training terms in $([IO.Path]::GetFullPath($policy))."
Write-Output 'In Privora, check the saved policy and review the current terms if requested.'
