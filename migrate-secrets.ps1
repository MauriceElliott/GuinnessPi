$SourceKV = "nehs-admissions-we-dev"
$SourceSub = "c03a2622-77d7-499e-af55-2aa498568ad4"
$DestKV = "tdi-nehs-admissions-dev2"
$DestSub = "18931172-a62b-46d2-83d6-1a25896b5379"

$Exclude = @(
    "ApplicationInsights--InstrumentationKey"
    "WebHooks--sendgrid--SecretKey--default"
)

# Switch to source subscription
az account set --subscription $SourceSub

# List all secrets and migrate them
$secrets = az keyvault secret list --vault-name $SourceKV --query "[].name" -o tsv

foreach ($secret in $secrets) {
    if ($secret -in $Exclude) {
        Write-Host "Skipping $secret"
        continue
    }

    Write-Host "Migrating $secret..."
    $value = az keyvault secret show --vault-name $SourceKV --name $secret --query value -o tsv
    
    # Switch to destination subscription
    az account set --subscription $DestSub
    az keyvault secret set --vault-name $DestKV --name $secret --value $value > $null
    
    # Switch back to source
    az account set --subscription $SourceSub
}

Write-Host "Migration complete"
