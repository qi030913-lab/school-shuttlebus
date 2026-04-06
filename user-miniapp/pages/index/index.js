const {
  request,
  WS_URL,
  calculateDistanceMeters,
  parseUpdateTimeToTimestamp,
  resolveVehicleCurrentSpeed,
  buildVehicleMotionSnapshot
} = require('../../utils')

const VEHICLE_MARKER_ICON = '/assets/bus-marker.png'
const USER_MARKER_ICON = '/assets/user-marker.png'
const USER_MARKER_ID = 1000000001
const VEHICLE_MARKER_ID_MOD = 1000000000
const POLL_INTERVAL_MS = 15000
const SOCKET_RETRY_BASE_MS = 2000
const SOCKET_RETRY_MAX_MS = 15000
const LOCATION_DEBUG_PREFIX = '[index][location]'

Page({
  data: {
    routes: [],
    routeIndex: 0,
    currentRouteId: '',
    routeName: '',
    routeServiceTime: '',
    routeProgressWidth: '72%',
    vehicles: [],
    mapLatitude: 39.909,
    mapLongitude: 116.397,
    markers: [],
    polyline: [],
    refreshing: false,
    userLocationText: '允许定位后可显示你与车辆的距离'
  },

  logLocationDebug(step, payload) {
    if (payload === undefined) {
      console.log(LOCATION_DEBUG_PREFIX, step)
      return
    }
    console.log(LOCATION_DEBUG_PREFIX, step, payload)
  },

  getRuntimeInfo() {
    if (typeof wx.getSystemInfoSync !== 'function') {
      return {
        platform: 'unknown'
      }
    }

    try {
      const systemInfo = wx.getSystemInfoSync()
      return {
        platform: systemInfo.platform || 'unknown',
        host: systemInfo.host || '',
        brand: systemInfo.brand || '',
        model: systemInfo.model || '',
        system: systemInfo.system || ''
      }
    } catch (error) {
      this.logLocationDebug('wx.getSystemInfoSync.fail', this.toDebugError(error))
      return {
        platform: 'unknown'
      }
    }
  },

  isDevtoolsPlatform() {
    return !!(this.runtimeInfo && this.runtimeInfo.platform === 'devtools')
  },

  isAndroidPlatform() {
    return !!(this.runtimeInfo && this.runtimeInfo.platform === 'android')
  },

  getInvalidLocationFeedback(error) {
    const isInvalidLocation = error && error.message === 'invalid-user-location'

    if (!isInvalidLocation) {
      return {
        userLocationText: '获取定位失败，暂不显示你与车辆的距离',
        toastTitle: '获取你的定位失败'
      }
    }

    if (this.isDevtoolsPlatform()) {
      return {
        userLocationText: '开发者工具返回的定位坐标异常，请检查位置模拟设置',
        toastTitle: '请检查位置模拟'
      }
    }

    return {
      userLocationText: '定位坐标异常，暂不显示你与车辆的距离',
      toastTitle: '定位坐标异常'
    }
  },

  toDebugError(error) {
    if (!error) {
      return null
    }

    return {
      errMsg: error.errMsg || '',
      errno: error.errno,
      code: error.code,
      message: error.message,
      stack: error.stack
    }
  },

  getPrivacySetting() {
    if (typeof wx.getPrivacySetting !== 'function') {
      return Promise.resolve({ supported: false })
    }

    return new Promise((resolve, reject) => {
      wx.getPrivacySetting({
        success: resolve,
        fail: reject
      })
    })
  },

  async logPrivacySetting(scene) {
    if (typeof wx.getPrivacySetting !== 'function') {
      this.logLocationDebug(`${scene}-privacy-setting-api-unavailable`)
      return null
    }

    try {
      const privacyRes = await this.getPrivacySetting()
      this.logLocationDebug(`${scene}-privacy-setting`, privacyRes)
      return privacyRes
    } catch (error) {
      this.logLocationDebug(`${scene}-privacy-setting-failed`, this.toDebugError(error))
      return null
    }
  },

  async onLoad() {
    this.socketTask = null
    this.socketReconnectTimer = null
    this.socketClosedByUser = false
    this.socketRetryCount = 0
    this.shouldResetMapCenter = true
    this.userLocation = null
    this.latestVehiclesRaw = []
    this.vehicleMotionMap = {}
    this.locationPollTimer = null
    this.runtimeInfo = this.getRuntimeInfo()

    this.logLocationDebug('runtime-info', this.runtimeInfo)

    await this.refreshUserLocation(true)
    await this.loadRoutes()
    this.connectSocket()

    this.pollTimer = setInterval(() => {
      this.loadOverview(false)
    }, POLL_INTERVAL_MS)

    this.startLocationPolling()
  },

  onUnload() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.locationPollTimer) {
      clearInterval(this.locationPollTimer)
      this.locationPollTimer = null
    }
    this.clearSocketReconnectTimer()
    this.socketClosedByUser = true
    if (this.socketTask) {
      this.socketTask.close()
      this.socketTask = null
    }
    this.vehicleMotionMap = {}
  },

  startLocationPolling() {
    if (this.locationPollTimer) {
      return
    }
    this.locationPollTimer = setInterval(() => {
      this.refreshUserLocation(true)
    }, POLL_INTERVAL_MS)
  },

  getSetting() {
    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: res => {
          this.logLocationDebug('wx.getSetting.success', {
            authSetting: res.authSetting || {}
          })
          resolve(res)
        },
        fail: err => {
          this.logLocationDebug('wx.getSetting.fail', this.toDebugError(err))
          reject(err)
        }
      })
    })
  },

  authorizeLocation() {
    return new Promise((resolve, reject) => {
      wx.authorize({
        scope: 'scope.userLocation',
        success: res => {
          this.logLocationDebug('wx.authorize.success', {
            scope: 'scope.userLocation',
            res
          })
          resolve(res)
        },
        fail: err => {
          this.logLocationDebug('wx.authorize.fail', this.toDebugError(err))
          reject(err)
        }
      })
    })
  },

  getLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        success: res => {
          this.logLocationDebug('wx.getLocation.success', {
            latitude: res.latitude,
            longitude: res.longitude,
            accuracy: res.accuracy,
            horizontalAccuracy: res.horizontalAccuracy,
            verticalAccuracy: res.verticalAccuracy,
            speed: res.speed
          })
          resolve(res)
        },
        fail: err => {
          this.logLocationDebug('wx.getLocation.fail', this.toDebugError(err))
          reject(err)
        }
      })
    })
  },

  async ensureLocationPermission(silent = true) {
    this.logLocationDebug('ensure-permission-start', { silent })
    try {
      const settingRes = await this.getSetting()
      const locationAuthorized = settingRes.authSetting && settingRes.authSetting['scope.userLocation']
      this.logLocationDebug('ensure-permission-state', {
        locationAuthorized,
        authSetting: settingRes.authSetting || {}
      })

      if (locationAuthorized === true) {
        this.logLocationDebug('ensure-permission-already-authorized')
        return true
      }

      if (locationAuthorized !== false) {
        try {
          this.logLocationDebug('ensure-permission-request-authorize')
          await this.authorizeLocation()
          this.logLocationDebug('ensure-permission-authorize-finished')
          return true
        } catch (e) {
          this.logLocationDebug('ensure-permission-authorize-rejected', this.toDebugError(e))
          if (!silent) {
            wx.showToast({ title: '请允许定位后再查看距离', icon: 'none' })
          }
          return false
        }
      }

      if (!silent) {
        wx.showToast({ title: '定位权限已关闭，请在设置中开启', icon: 'none' })
      }
      this.logLocationDebug('ensure-permission-denied-in-setting')
      return false
    } catch (e) {
      this.logLocationDebug('ensure-permission-check-failed', this.toDebugError(e))
      if (!silent) {
        wx.showToast({ title: '定位权限检查失败', icon: 'none' })
      }
      return false
    }
  },

  async refreshUserLocation(silent = true) {
    this.logLocationDebug('refresh-user-location-start', {
      silent,
      currentRouteId: this.data.currentRouteId || ''
    })
    const hasPermission = await this.ensureLocationPermission(silent)
    this.logLocationDebug('refresh-user-location-permission-result', { hasPermission })
    if (!hasPermission) {
      this.userLocation = null
      this.setData({
        userLocationText: '允许定位后可显示你与车辆的距离'
      })
      if (this.latestVehiclesRaw) {
        this.applyVehicles(this.latestVehiclesRaw)
      }
      this.logLocationDebug('refresh-user-location-stop-no-permission')
      return false
    }

    await this.logPrivacySetting('before-get-location')

    try {
      const location = await this.getLocation()
      const userLocation = this.normalizeCoordinatePair(location.latitude, location.longitude, 'user-location')
      this.logLocationDebug('refresh-user-location-normalized', {
        rawLatitude: location.latitude,
        rawLongitude: location.longitude,
        normalizedLatitude: userLocation.latitude,
        normalizedLongitude: userLocation.longitude
      })
      if (userLocation.latitude === null || userLocation.longitude === null) {
        this.logLocationDebug('refresh-user-location-invalid-normalized-coordinate', {
          rawLatitude: location.latitude,
          rawLongitude: location.longitude
        })
        throw new Error('invalid-user-location')
      }
      this.userLocation = userLocation
      this.setData({
        userLocationText: '已显示你的位置，并连线到在线车辆'
      })
      this.applyVehicles(this.latestVehiclesRaw)
      this.logLocationDebug('refresh-user-location-success', { userLocation })
      return true
    } catch (e) {
      await this.logPrivacySetting('after-get-location-failed')
      const feedback = this.getInvalidLocationFeedback(e)
      if (e && e.message === 'invalid-user-location' && this.isDevtoolsPlatform()) {
        this.logLocationDebug('devtools-invalid-location-detected', {
          runtimeInfo: this.runtimeInfo
        })
      }
      this.logLocationDebug('refresh-user-location-failed', {
        error: this.toDebugError(e),
        currentRouteId: this.data.currentRouteId || '',
        runtimeInfo: this.runtimeInfo
      })
      this.userLocation = null
      this.setData({
        userLocationText: feedback.userLocationText
      })
      if (this.latestVehiclesRaw) {
        this.applyVehicles(this.latestVehiclesRaw)
      }
      if (!silent) {
        wx.showToast({ title: feedback.toastTitle, icon: 'none' })
      }
      return false
    }
  },

  setSocketStatus(status) {
    this.socketStatus = status || 'disconnected'
  },

  clearSocketReconnectTimer() {
    if (this.socketReconnectTimer) {
      clearTimeout(this.socketReconnectTimer)
      this.socketReconnectTimer = null
    }
  },

  scheduleSocketReconnect() {
    if (this.socketClosedByUser || this.socketReconnectTimer) {
      return
    }

    this.socketRetryCount += 1
    this.setSocketStatus('reconnecting')

    const delay = Math.min(SOCKET_RETRY_MAX_MS, SOCKET_RETRY_BASE_MS * this.socketRetryCount)
    this.socketReconnectTimer = setTimeout(() => {
      this.socketReconnectTimer = null
      if (!this.socketClosedByUser) {
        this.connectSocket()
      }
    }, delay)
  },

  connectSocket() {
    this.clearSocketReconnectTimer()
    this.setSocketStatus(this.socketRetryCount > 0 ? 'reconnecting' : 'connecting')

    const socketTask = wx.connectSocket({ url: WS_URL })
    this.socketTask = socketTask

    socketTask.onOpen(() => {
      if (this.socketTask !== socketTask) {
        return
      }
      this.socketRetryCount = 0
      this.setSocketStatus('connected')
    })

    socketTask.onMessage((res) => {
      if (this.socketTask !== socketTask) {
        return
      }

      try {
        const body = JSON.parse(res.data)
        const vehicles = Array.isArray(body && body.data) ? body.data : []
        const filtered = vehicles.filter(item => !this.data.currentRouteId || item.routeId === this.data.currentRouteId)
        this.applyVehicles(filtered)
      } catch (e) {
        console.log('socket parse skip', e)
      }
    })

    socketTask.onError(() => {
      if (this.socketTask !== socketTask) {
        return
      }
      this.setSocketStatus('reconnecting')
    })

    socketTask.onClose(() => {
      if (this.socketTask !== socketTask) {
        return
      }
      this.socketTask = null
      if (this.socketClosedByUser) {
        this.setSocketStatus('disconnected')
        return
      }
      this.scheduleSocketReconnect()
    })
  },

  async loadRoutes() {
    try {
      const routes = await request('/api/common/routes')
      const first = routes[0] || {}
      this.shouldResetMapCenter = true
      this.setData({
        routes,
        routeIndex: 0,
        currentRouteId: first.routeId || '',
        routeName: first.routeName || '',
        routeServiceTime: first.serviceTime || ''
      })
      if (first.routeId) {
        await this.loadOverview(false, first.routeId)
      }
    } catch (e) {
      wx.showToast({ title: '加载线路失败', icon: 'none' })
    }
  },

  onRouteChange(e) {
    const routeIndex = Number(e.detail.value)
    const route = this.data.routes[routeIndex] || {}

    this.shouldResetMapCenter = true
    this.setData({
      routeIndex,
      currentRouteId: route.routeId || '',
      routeName: route.routeName || '',
      routeServiceTime: route.serviceTime || ''
    })

    this.loadOverview(true, route.routeId || '')
  },

  async refreshAll() {
    this.logLocationDebug('refresh-all-start', {
      currentRouteId: this.data.currentRouteId || '',
      refreshing: this.data.refreshing
    })
    const locationRefreshed = await this.refreshUserLocation(false)
    this.logLocationDebug('refresh-all-after-location', {
      locationRefreshed
    })
    await this.loadOverview(true)
    this.logLocationDebug('refresh-all-finished')
  },

  goToVehicleDetail(e) {
    const { vehicleId } = e.currentTarget.dataset || {}
    if (!vehicleId) {
      return
    }

    const query = [
      `vehicleId=${encodeURIComponent(vehicleId)}`,
      `routeId=${encodeURIComponent(this.data.currentRouteId || '')}`,
      `routeName=${encodeURIComponent(this.data.routeName || '')}`,
      `serviceTime=${encodeURIComponent(this.data.routeServiceTime || '')}`
    ].join('&')

    wx.navigateTo({
      url: `/pages/vehicles/index?${query}`
    })
  },

  async loadOverview(showLoading = true, routeId = '') {
    const shouldShowLoading = typeof showLoading === 'boolean' ? showLoading : true
    const targetRouteId = routeId || this.data.currentRouteId
    if (!targetRouteId) {
      return
    }

    if (shouldShowLoading) {
      this.setData({ refreshing: true })
    }

    try {
      const overview = await request(`/api/user/overview?routeId=${targetRouteId}`)
      if (targetRouteId !== this.data.currentRouteId) {
        return
      }
      this.applyOverview(overview)
    } catch (e) {
      wx.showToast({ title: '刷新失败', icon: 'none' })
    } finally {
      if (shouldShowLoading) {
        this.setData({ refreshing: false })
      }
    }
  },

  applyOverview(overview) {
    const vehicles = Array.isArray(overview.vehicles) ? overview.vehicles : []
    const route = overview.route || {}
    const nextServiceTime = route.serviceTime || this.data.routeServiceTime

    this.setData({
      routeName: route.routeName || this.data.routeName,
      routeServiceTime: nextServiceTime,
      routeProgressWidth: this.getRouteProgressWidth(nextServiceTime)
    })

    this.applyVehicles(vehicles)
  },

  dedupeVehiclesById(vehicles) {
    const list = Array.isArray(vehicles) ? vehicles : []
    const deduped = []
    const indexMap = {}

    list.forEach((item, index) => {
      if (!item || !item.vehicleId) {
        deduped.push(item)
        return
      }

      const key = String(item.vehicleId)
      const existingIndex = indexMap[key]
      if (existingIndex === undefined) {
        indexMap[key] = deduped.length
        deduped.push(item)
        return
      }

      if (this.shouldReplaceVehicleRecord(deduped[existingIndex], item, index)) {
        deduped[existingIndex] = item
      }
    })

    return deduped.filter(Boolean)
  },

  shouldReplaceVehicleRecord(currentItem, nextItem) {
    const currentUpdateAt = parseUpdateTimeToTimestamp(currentItem && currentItem.updateTime)
    const nextUpdateAt = parseUpdateTimeToTimestamp(nextItem && nextItem.updateTime)

    if (currentUpdateAt !== null && nextUpdateAt !== null && currentUpdateAt !== nextUpdateAt) {
      return nextUpdateAt > currentUpdateAt
    }

    if (currentUpdateAt === null && nextUpdateAt !== null) {
      return true
    }

    if (currentUpdateAt !== null && nextUpdateAt === null) {
      return false
    }

    const currentLocation = this.normalizeCoordinatePair(
      currentItem && currentItem.latitude,
      currentItem && currentItem.longitude
    )
    const nextLocation = this.normalizeCoordinatePair(
      nextItem && nextItem.latitude,
      nextItem && nextItem.longitude
    )
    const currentHasLocation = currentLocation.latitude !== null && currentLocation.longitude !== null
    const nextHasLocation = nextLocation.latitude !== null && nextLocation.longitude !== null

    if (currentHasLocation !== nextHasLocation) {
      return nextHasLocation
    }

    return true
  },

  applyVehicles(vehicles) {
    this.latestVehiclesRaw = this.dedupeVehiclesById(vehicles)
    const receivedAt = Date.now()
    const nextVehicleIds = {}
    this.latestVehiclesRaw.forEach((item) => {
      if (item && item.vehicleId) {
        nextVehicleIds[item.vehicleId] = true
      }
    })
    Object.keys(this.vehicleMotionMap).forEach((vehicleId) => {
      if (!nextVehicleIds[vehicleId]) {
        delete this.vehicleMotionMap[vehicleId]
      }
    })
    const decoratedVehicles = this.latestVehiclesRaw.map(item => this.decorateVehicle(item, receivedAt))
    const vehicleMarkers = this.buildVehicleMarkers(decoratedVehicles)
    const userMarker = this.buildUserMarker()
    const markers = userMarker ? [...vehicleMarkers, userMarker] : vehicleMarkers
    const distanceLines = this.buildDistanceLines(decoratedVehicles)

    const nextState = {
      vehicles: decoratedVehicles,
      markers,
      polyline: distanceLines
    }

    if (this.shouldResetMapCenter) {
      const firstVehicle = decoratedVehicles.find(item => item.latitude !== null && item.longitude !== null)
      const firstPoint = firstVehicle || userMarker
      nextState.mapLatitude = firstPoint ? firstPoint.latitude : 39.909
      nextState.mapLongitude = firstPoint ? firstPoint.longitude : 116.397
      this.shouldResetMapCenter = false
    }

    this.setData(nextState)
  },

  buildUserMarker() {
    if (!this.userLocation) {
      return null
    }

    return {
      id: USER_MARKER_ID,
      latitude: this.userLocation.latitude,
      longitude: this.userLocation.longitude,
      iconPath: USER_MARKER_ICON,
      width: 28,
      height: 28,
      anchor: {
        x: 0.5,
        y: 0.5
      },
      callout: {
        content: '我',
        display: 'BYCLICK',
        fontSize: 11,
        padding: 4,
        borderRadius: 12,
        color: '#0f172a',
        bgColor: '#ffffff',
        borderColor: '#93c5fd',
        borderWidth: 1
      }
    }
  },

  buildDistanceLines(vehicles) {
    if (!this.userLocation) {
      return []
    }

    return vehicles
      .filter(item => item.latitude !== null && item.longitude !== null)
      .map(item => ({
        points: [
          {
            latitude: this.userLocation.latitude,
            longitude: this.userLocation.longitude
          },
          {
            latitude: item.latitude,
            longitude: item.longitude
          }
        ],
        color: item.status === 'RUNNING' ? '#0f766ecc' : '#94a3b8cc',
        width: 4,
        dottedLine: true
      }))
  },

  buildVehicleMarkerId(items) {
    const seed = items
      .map(item => item.vehicleId || '')
      .filter(Boolean)
      .sort()
      .join('|') || 'vehicle-marker'

    let hash = 0
    for (let i = 0; i < seed.length; i += 1) {
      hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
    }

    return (Math.abs(hash) % VEHICLE_MARKER_ID_MOD) + 1
  },

  buildVehicleMarkerBadge(items, clusterStatus) {
    const content = this.buildVehicleMarkerLabel(items)
    const bgColor = clusterStatus === 'RUNNING' ? '#0f766e' : '#9aa8b4'

    if (this.isAndroidPlatform()) {
      return {
        label: {
          content,
          color: '#ffffff',
          fontSize: 12,
          padding: 6,
          borderRadius: 16,
          bgColor,
          borderColor: bgColor,
          borderWidth: 1,
          textAlign: 'center',
          anchorX: 0,
          anchorY: -42
        }
      }
    }

    return {
      callout: {
        content,
        display: 'ALWAYS',
        fontSize: 12,
        padding: 6,
        borderRadius: 16,
        color: '#ffffff',
        bgColor,
        borderColor: bgColor,
        borderWidth: 1
      }
    }
  },

  buildVehicleMarkers(vehicles) {
    const clusters = []

    vehicles
      .filter(item => item.latitude !== null && item.longitude !== null)
      .forEach((item) => {
        const cluster = this.findMarkerClusterByCoordinate(clusters, item.latitude, item.longitude)
        if (cluster) {
          cluster.items.push(item)
          return
        }

        clusters.push({
          latitude: item.latitude,
          longitude: item.longitude,
          items: [item]
        })
      })

    return clusters.map((cluster, index) => {
      const clusterStatus = this.getClusterStatus(cluster.items)
      const badgeConfig = this.buildVehicleMarkerBadge(cluster.items, clusterStatus)

      return {
        id: this.buildVehicleMarkerId(cluster.items),
        latitude: cluster.latitude,
        longitude: cluster.longitude,
        iconPath: VEHICLE_MARKER_ICON,
        width: cluster.items.length > 1 ? 38 : 34,
        height: cluster.items.length > 1 ? 38 : 34,
        anchor: {
          x: 0.5,
          y: 0.7
        },
        ...badgeConfig
      }
    })
  },

  findMarkerClusterByCoordinate(clusters, latitude, longitude) {
    return clusters.find(cluster => (
      cluster.latitude === latitude && cluster.longitude === longitude
    ))
  },

  getClusterStatus(items) {
    return items.some(item => item.status === 'RUNNING') ? 'RUNNING' : 'STOPPED'
  },

  buildVehicleMarkerLabel(items) {
    if (!items.length) {
      return ''
    }

    if (items.length === 1) {
      return items[0].vehicleId
    }

    return `${items[0].vehicleId} 等${items.length}辆`
  },

  decorateVehicle(item, receivedAt = Date.now()) {
    const { latitude, longitude } = this.normalizeCoordinatePair(item.latitude, item.longitude)
    const previousMotion = this.vehicleMotionMap[item.vehicleId] || null
    const speed = resolveVehicleCurrentSpeed({
      latitude,
      longitude,
      speed: item.speed,
      updateTime: item.updateTime,
      status: item.status
    }, previousMotion, receivedAt)
    this.vehicleMotionMap[item.vehicleId] = buildVehicleMotionSnapshot(
      item,
      latitude,
      longitude,
      speed,
      receivedAt
    )
    const distanceMeters = this.userLocation && latitude !== null && longitude !== null
      ? calculateDistanceMeters(
        this.userLocation.latitude,
        this.userLocation.longitude,
        latitude,
        longitude
      )
      : null

    return {
      ...item,
      latitude,
      longitude,
      status: item.status || 'UNKNOWN',
      distanceText: distanceMeters === null ? '未开启用户定位' : `距离你 ${this.formatDistance(distanceMeters)}`,
      speedText: `${Number(speed || 0).toFixed(1)} m/s`,
      speedValueText: Number(speed || 0).toFixed(1),
      speedUnitText: 'm/s'
    }
  },

  parseCoordinate(value) {
    if (value === null || value === undefined || value === '') {
      return null
    }
    const num = Number(value)
    return Number.isFinite(num) ? num : null
  },

  isValidLatitude(value) {
    return typeof value === 'number' && value >= -90 && value <= 90
  },

  isValidLongitude(value) {
    return typeof value === 'number' && value >= -180 && value <= 180
  },

  normalizeCoordinatePair(latitudeValue, longitudeValue, debugSource = '') {
    const latitude = this.parseCoordinate(latitudeValue)
    const longitude = this.parseCoordinate(longitudeValue)

    if (latitude === null || longitude === null) {
      if (debugSource) {
        this.logLocationDebug(`${debugSource}-coordinate-missing`, {
          latitudeValue,
          longitudeValue,
          latitude,
          longitude
        })
      }
      return {
        latitude: null,
        longitude: null
      }
    }

    if (this.isValidLatitude(latitude) && this.isValidLongitude(longitude)) {
      return { latitude, longitude }
    }

    if (this.isValidLatitude(longitude) && this.isValidLongitude(latitude)) {
      if (debugSource) {
        this.logLocationDebug(`${debugSource}-coordinate-swapped`, {
          latitudeValue,
          longitudeValue,
          normalizedLatitude: longitude,
          normalizedLongitude: latitude
        })
      }
      return {
        latitude: longitude,
        longitude: latitude
      }
    }

    if (debugSource) {
      this.logLocationDebug(`${debugSource}-coordinate-invalid`, {
        latitudeValue,
        longitudeValue,
        latitude,
        longitude
      })
    }

    return {
      latitude: null,
      longitude: null
    }
  },

  formatDistance(distanceMeters) {
    if (distanceMeters < 1000) {
      return `${Math.round(distanceMeters)}m`
    }
    if (distanceMeters < 10000) {
      return `${(distanceMeters / 1000).toFixed(1)}km`
    }
    return `${Math.round(distanceMeters / 1000)}km`
  },

  getRouteProgressWidth(serviceTime) {
    if (!serviceTime || !serviceTime.includes('-')) {
      return '72%'
    }

    const [startText, endText] = serviceTime.split('-')
    const startHour = this.parseTimeToMinutes(startText)
    const endHour = this.parseTimeToMinutes(endText)
    if (startHour === null || endHour === null || endHour <= startHour) {
      return '72%'
    }

    const now = new Date()
    const currentMinutes = now.getHours() * 60 + now.getMinutes()
    const clamped = Math.min(Math.max(currentMinutes, startHour), endHour)
    const ratio = (clamped - startHour) / (endHour - startHour)
    const percent = 18 + ratio * 70
    return `${percent.toFixed(0)}%`
  },

  parseTimeToMinutes(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!match) {
      return null
    }

    const hours = Number(match[1])
    const minutes = Number(match[2])
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return null
    }

    return hours * 60 + minutes
  }
})
