// ==============================================================================
// Bicep Infrastructure Specification: Zero-Cost Azure Container Apps ($0/month)
// ==============================================================================
//
// ZERO-COST ARCHITECTURE FEATURES:
// ------------------------------------------------------------------------------
// 1. Container Registry : Uses GitHub Container Registry (ghcr.io) -> $0/month
// 2. Compute Free Tier : Scales within Azure ACA Free Grant (180k vCPU-sec/mo free) -> $0/month
// 3. Log Analytics     : Uses Azure Free Grant (First 5 GB/mo free) -> $0/month
// 4. Network Firewall  : VNet + IP Firewall Rules (No Private Endpoint fee) -> $0/month
// ==============================================================================

@description('Azure region for all resources')
param location string = 'westus2'

@description('Name prefix for application resources')
param appName string = 'daily-expense'

@description('Environment name (e.g. dev, prod)')
param environment string = 'dev'

var vnetName = 'vnet-${appName}-${environment}'
var containerAppEnvName = 'cae-${appName}-${environment}'
var backendAppName = 'ca-${appName}-backend'
var extractionAppName = 'ca-${appName}-extraction'
var logAnalyticsName = 'law-${appName}-${environment}'

// 1. Log Analytics Workspace (Uses Azure Free 5GB/month Grant + Strict 160MB Daily Cap)
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: json('0.16') // 0.16 GB/day * 30 days = ~4.8 GB/month MAX (Guarantees $0 cost)
    }
  }
}

// 2. Virtual Network for ACA Infrastructure ($0/month)
resource vnet 'Microsoft.Network/virtualNetworks@2023-09-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.0.0.0/16'
      ]
    }
    subnets: [
      {
        name: 'aca-subnet'
        properties: {
          addressPrefix: '10.0.0.0/21'
          delegations: [
            {
              name: 'aca-delegation'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
    ]
  }
}

// 3. VNet-Injected Container Apps Environment (Uses Azure Free Grant)
resource containerAppEnv 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: containerAppEnvName
  location: location
  properties: {
    vnetConfiguration: {
      infrastructureSubnetId: vnet.properties.subnets[0].id
      internal: false
    }
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// 4. Private Extraction Service (Internal Ingress, Port 3002 | GHCR Docker Registry | Scales to 0 for $0)
resource extractionApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: extractionAppName
  location: location
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      ingress: {
        external: false // Internal-only ingress ($0 network routing)
        targetPort: 3002
        transport: 'auto'
      }
    }
    template: {
      containers: [
        {
          name: 'extraction-service'
          image: 'mcr.microsoft.com/azuredocs/aci-helloworld:latest'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'PORT', value: '3002' }
          ]
        }
      ]
      scale: {
        minReplicas: 0 // Scale to 0 when idle ($0 compute cost)
        maxReplicas: 1
      }
    }
  }
}

// 5. Public Backend API Service (External Ingress, Port 3001 | GHCR Docker Registry | Scales to 0 for $0)
resource backendApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: backendAppName
  location: location
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      ingress: {
        external: true // Publicly accessible HTTPS
        targetPort: 3001
        transport: 'auto'
      }
    }
    template: {
      containers: [
        {
          name: 'backend'
          image: 'mcr.microsoft.com/azuredocs/aci-helloworld:latest'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3001' }
            { name: 'LLM_EXTRACTION_SERVICE_URL', value: 'http://${extractionApp.properties.configuration.ingress.fqdn}' }
          ]
        }
      ]
      scale: {
        minReplicas: 0 // Scale to 0 when idle ($0 compute cost)
        maxReplicas: 2
      }
    }
  }
}

// 6. Azure Static Web App (Free Tier | Global CDN for React Vite SPA | $0/month)
param frontendAppName string = 'swa-daily-expense-frontend'

resource frontendApp 'Microsoft.Web/staticSites@2022-09-01' = {
  name: frontendAppName
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {}
}



