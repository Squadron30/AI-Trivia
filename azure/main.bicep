// ============================================================================
// AI Trivia — Azure infrastructure (App Service + Azure Cache for Redis)
// Deploys a Linux Node web app with WebSockets + session affinity (required
// for Socket.IO) and a Redis cache used as the Socket.IO scale-out adapter so
// the app can run multiple instances and comfortably handle 200+ users.
// ============================================================================

@description('Base name for all resources')
param appName string = 'ai-trivia'

@description('Azure region')
param location string = resourceGroup().location

@description('App Service plan SKU. P1v3 recommended for 200+ concurrent websocket users.')
param planSku string = 'P1v3'

@description('Number of instances to run (scale-out). Redis adapter keeps them in sync.')
@minValue(1)
@maxValue(10)
param instanceCount int = 2

var planName  = '${appName}-plan'
var siteName  = '${appName}-${uniqueString(resourceGroup().id)}'
var redisName = '${appName}-redis-${uniqueString(resourceGroup().id)}'

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  sku: { name: planSku, capacity: instanceCount }
  kind: 'linux'
  properties: { reserved: true }
}

resource redis 'Microsoft.Cache/redis@2024-03-01' = {
  name: redisName
  location: location
  properties: {
    sku: { name: 'Basic', family: 'C', capacity: 1 }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
  }
}

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: siteName
  location: location
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: true      // ARR affinity / sticky sessions — required for Socket.IO
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      webSocketsEnabled: true         // required for real-time transport
      alwaysOn: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appCommandLine: 'node server/server.js'
      appSettings: [
        { name: 'PORT', value: '8080' }
        { name: 'WEBSITES_PORT', value: '8080' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'true' }
        { name: 'REDIS_URL', value: 'rediss://:${redis.listKeys().primaryKey}@${redis.properties.hostName}:6380' }
      ]
    }
  }
}

output siteUrl string = 'https://${site.properties.defaultHostName}'
output presenterUrl string = 'https://${site.properties.defaultHostName}/presenter.html'
output redisHost string = redis.properties.hostName
