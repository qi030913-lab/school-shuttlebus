const {
  request,
  calculateDistanceMeters,
  parseUpdateTimeToTimestamp,
  resolveVehicleCurrentSpeed,
  buildVehicleMotionSnapshot
} = require('../../utils')
const socketModule = require('../../common/socket')
const locationModule = require('../../common/location')

const VEHICLE_MARKER_ICON = '/assets/bus-marker.png'
const USER_MARKER_ICON = '/assets/user-marker.png'
const VEHICLE_MAP_ID = 'vehicleMap'
const USER_MARKER_ID = 1000000001
const VEHICLE_MARKER_ID_MOD = 1000000000
const VEHICLE_MARKER_ANIMATION_DEFAULT_DURATION_MS = 900
const VEHICLE_MARKER_ANIMATION_MIN_DURATION_MS = 240
const VEHICLE_MARKER_ANIMATION_MAX_DURATION_MS = 1800
const VEHICLE_MARKER_ANIMATION_GAP_RATIO = 0.9
const VEHICLE_MARKER_ANIMATION_STEP_MS = 33
const VEHICLE_MARKER_SYNC_BUFFER_MS = 80
const MARKER_COORDINATE_EPSILON = 0.0000001
const MARKER_ANGLE_EPSILON = 2
const MIN_VEHICLE_MARKER_MOVEMENT_DISTANCE_METERS = 3
const MIN_STOPPED_VEHICLE_MARKER_MOVEMENT_DISTANCE_METERS = 8
const MIN_VEHICLE_HEADING_UPDATE_DISTANCE_METERS = 5
const POLL_INTERVAL_MS = 15000
const SOCKET_RETRY_BASE_MS = 2000
const SOCKET_RETRY_MAX_MS = 15000
const LOCATION_DEBUG_PREFIX = '[index][location]'
const DEFAULT_USER_LOCATION = Object.freeze({
  latitude: 36.239600,
  longitude: 117.292518
})
const DEFAULT_USER_LOCATION_TEXT = '当前按默认位置显示你与车辆的距离'

module.exports = {
  data: {
    routes: [],
    routeIndex: 0,
    currentRouteId: '',
    routeName: '',
    routeServiceTime: '',
    routeProgressWidth: '72%',
    vehicles: [],
    mapLatitude: DEFAULT_USER_LOCATION.latitude,
    mapLongitude: DEFAULT_USER_LOCATION.longitude,
    markers: [],
    polyline: [],
    refreshing: false,
    userLocationText: DEFAULT_USER_LOCATION_TEXT
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

  getDefaultUserLocation() {
    return {
      latitude: DEFAULT_USER_LOCATION.latitude,
      longitude: DEFAULT_USER_LOCATION.longitude
    }
  },

  applyDefaultUserLocation(reason = '') {
    const defaultLocation = this.getDefaultUserLocation()

    if (reason) {
      this.logLocationDebug('use-default-user-location', {
        reason,
        latitude: defaultLocation.latitude,
        longitude: defaultLocation.longitude
      })
    }

    this.userLocation = defaultLocation
    this.setData({
      userLocationText: DEFAULT_USER_LOCATION_TEXT
    })
    this.refreshVehiclePresentation()
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
    this.mapContext = null
    this.socketTask = null
    this.socketReconnectTimer = null
    this.socketClosedByUser = false
    this.socketRetryCount = 0
    this.socketRetryBaseMs = SOCKET_RETRY_BASE_MS
    this.socketRetryMaxMs = SOCKET_RETRY_MAX_MS
    this.vehicleMarkerAnimationTimer = null
    this.vehicleMarkerDataSyncTimer = null
    this.vehicleMarkerDataSyncVersion = 0
    this.shouldResetMapCenter = true
    this.userLocation = this.getDefaultUserLocation()
    this.latestVehiclesRaw = []
    this.vehicleMarkers = []
    this.vehicleMotionMap = {}
    this.lastVehicleMarkerChangeAt = 0
    this.locationPollTimer = null
    this.locationPollIntervalMs = POLL_INTERVAL_MS
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

  onReady() {
    this.ensureMapContext()
  },

  onUnload() {
    this.clearVehicleMarkerAnimation()
    this.clearVehicleMarkerDataSyncTimer()
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
    this.vehicleMarkers = []
    this.vehicleMotionMap = {}
  },

  filterSocketVehicles(vehicles) {
    return vehicles.filter(item => !this.data.currentRouteId || item.routeId === this.data.currentRouteId)
  },

  handleSocketVehicles(vehicles) {
    this.applyVehicles(vehicles)
  },

  handleSocketParseError(error) {
    console.log('socket parse skip', error)
  },

  ensureMapContext() {
    if (this.mapContext || typeof wx.createMapContext !== 'function') {
      return this.mapContext
    }

    try {
      this.mapContext = wx.createMapContext(VEHICLE_MAP_ID, this)
    } catch (error) {
      this.logLocationDebug('wx.createMapContext.fail', this.toDebugError(error))
      this.mapContext = null
    }

    return this.mapContext
  },

  setSocketStatus(status) {
    this.socketStatus = status || 'disconnected'
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
      const isBackgroundPoll = !shouldShowLoading && !routeId
      const includeVehicles = !(isBackgroundPoll && this.socketStatus === 'connected')
      this.applyOverview(overview, { includeVehicles })
    } catch (e) {
      wx.showToast({ title: '刷新失败', icon: 'none' })
    } finally {
      if (shouldShowLoading) {
        this.setData({ refreshing: false })
      }
    }
  },

  applyOverview(overview, options = {}) {
    const { includeVehicles = true } = options
    const vehicles = Array.isArray(overview.vehicles) ? overview.vehicles : []
    const route = overview.route || {}
    const nextServiceTime = route.serviceTime || this.data.routeServiceTime

    this.setData({
      routeName: route.routeName || this.data.routeName,
      routeServiceTime: nextServiceTime,
      routeProgressWidth: this.getRouteProgressWidth(nextServiceTime)
    })

    if (includeVehicles) {
      this.applyVehicles(vehicles)
    }
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

  buildVehicleDataMap(vehicles) {
    const vehicleDataMap = {}
    ;(Array.isArray(vehicles) ? vehicles : []).forEach((item) => {
      if (item && item.vehicleId) {
        vehicleDataMap[String(item.vehicleId)] = item
      }
    })
    return vehicleDataMap
  },

  resolveIncomingVehicleRecords(vehicles) {
    const previousVehicleDataMap = this.buildVehicleDataMap(this.data.vehicles)

    return (Array.isArray(vehicles) ? vehicles : []).map((item) => {
      if (!item || !item.vehicleId) {
        return item
      }

      const previousMotion = this.vehicleMotionMap[item.vehicleId] || null
      const previousVehicle = previousVehicleDataMap[String(item.vehicleId)] || null
      const incomingUpdateAt = parseUpdateTimeToTimestamp(item.updateTime)
      const previousUpdateAt = previousMotion && Number.isFinite(previousMotion.timestamp)
        ? previousMotion.timestamp
        : parseUpdateTimeToTimestamp(previousVehicle && previousVehicle.updateTime)

      if (
        incomingUpdateAt !== null
        && previousUpdateAt !== null
        && incomingUpdateAt < previousUpdateAt
        && previousVehicle
      ) {
        return previousVehicle
      }

      return item
    })
  },

  clearVehicleMarkerAnimation() {
    if (this.vehicleMarkerAnimationTimer) {
      clearTimeout(this.vehicleMarkerAnimationTimer)
      this.vehicleMarkerAnimationTimer = null
    }
  },

  clearVehicleMarkerDataSyncTimer() {
    if (this.vehicleMarkerDataSyncTimer) {
      clearTimeout(this.vehicleMarkerDataSyncTimer)
      this.vehicleMarkerDataSyncTimer = null
    }
  },

  mergeVehicleAndUserMarkers(vehicleMarkers, userMarker = this.buildUserMarker()) {
    const nextVehicleMarkers = Array.isArray(vehicleMarkers)
      ? vehicleMarkers.filter(Boolean)
      : []
    return userMarker ? [...nextVehicleMarkers, userMarker] : nextVehicleMarkers
  },

  syncVehicleMarkersToData() {
    this.setData({
      markers: this.mergeVehicleAndUserMarkers(this.vehicleMarkers)
    })
  },

  scheduleVehicleMarkerDataSync(delayMs = 0) {
    this.clearVehicleMarkerDataSyncTimer()
    const version = this.vehicleMarkerDataSyncVersion + 1
    this.vehicleMarkerDataSyncVersion = version
    const syncDelayMs = Math.max(0, Number(delayMs) || 0) + VEHICLE_MARKER_SYNC_BUFFER_MS

    this.vehicleMarkerDataSyncTimer = setTimeout(() => {
      if (this.vehicleMarkerDataSyncVersion !== version) {
        return
      }
      this.vehicleMarkerDataSyncTimer = null
      this.syncVehicleMarkersToData()
    }, syncDelayMs)
  },

  updateAnimatedVehicleMarkers(vehicleMarkers) {
    this.vehicleMarkers = Array.isArray(vehicleMarkers) ? vehicleMarkers : []
    this.setData({
      markers: this.mergeVehicleAndUserMarkers(this.vehicleMarkers)
    })
  },

  animateVehicleMarkers(previousMarkers, nextVehicleMarkers, animationDurationMs = VEHICLE_MARKER_ANIMATION_DEFAULT_DURATION_MS) {
    this.clearVehicleMarkerAnimation()

    if (!previousMarkers.length || !nextVehicleMarkers.length) {
      this.updateAnimatedVehicleMarkers(nextVehicleMarkers)
      return
    }

    const previousMarkerMap = {}
    previousMarkers.forEach((marker) => {
      if (marker && marker.id !== USER_MARKER_ID) {
        previousMarkerMap[marker.id] = marker
      }
    })

    const normalizedDurationMs = Math.min(
      VEHICLE_MARKER_ANIMATION_MAX_DURATION_MS,
      Math.max(
        VEHICLE_MARKER_ANIMATION_MIN_DURATION_MS,
        Number(animationDurationMs) || VEHICLE_MARKER_ANIMATION_DEFAULT_DURATION_MS
      )
    )
    const animationFrames = Math.max(1, Math.round(
      normalizedDurationMs / VEHICLE_MARKER_ANIMATION_STEP_MS
    ))

    let frameIndex = 0
    const runFrame = () => {
      frameIndex += 1
      const progress = Math.min(1, frameIndex / animationFrames)
      const frameMarkers = nextVehicleMarkers.map((marker) => {
        const previousMarker = previousMarkerMap[marker.id]
        if (!previousMarker) {
          return marker
        }

        return {
          ...marker,
          latitude: previousMarker.latitude + (marker.latitude - previousMarker.latitude) * progress,
          longitude: previousMarker.longitude + (marker.longitude - previousMarker.longitude) * progress,
          rotation: (previousMarker.rotation || 0) + this.getAngleDelta(
            previousMarker.rotation || 0,
            marker.rotation || 0
          ) * progress,
          rotate: (previousMarker.rotate || 0) + this.getAngleDelta(
            previousMarker.rotate || 0,
            marker.rotate || 0
          ) * progress
        }
      })

      this.updateAnimatedVehicleMarkers(frameMarkers)

      if (progress < 1) {
        this.vehicleMarkerAnimationTimer = setTimeout(runFrame, VEHICLE_MARKER_ANIMATION_STEP_MS)
      } else {
        this.vehicleMarkerAnimationTimer = null
      }
    }

    this.vehicleMarkerAnimationTimer = setTimeout(runFrame, VEHICLE_MARKER_ANIMATION_STEP_MS)
  },

  canUseNativeVehicleMarkerAnimation(previousMarkers, nextVehicleMarkers) {
    if (!this.isAndroidPlatform()) {
      return false
    }

    const mapContext = this.ensureMapContext()
    if (!mapContext || typeof mapContext.translateMarker !== 'function') {
      return false
    }

    if (!previousMarkers.length || previousMarkers.length !== nextVehicleMarkers.length) {
      return false
    }

    const previousMarkerMap = {}
    previousMarkers.forEach((marker) => {
      if (marker) {
        previousMarkerMap[marker.id] = marker
      }
    })

    return nextVehicleMarkers.every(marker => marker && previousMarkerMap[marker.id])
  },

  animateVehicleMarkersOnAndroid(previousMarkers, nextVehicleMarkers, animationDurationMs = VEHICLE_MARKER_ANIMATION_DEFAULT_DURATION_MS) {
    this.clearVehicleMarkerAnimation()
    this.clearVehicleMarkerDataSyncTimer()

    const mapContext = this.ensureMapContext()
    if (!mapContext || typeof mapContext.translateMarker !== 'function') {
      this.syncVehicleMarkersToData()
      return
    }

    const previousMarkerMap = {}
    previousMarkers.forEach((marker) => {
      if (marker) {
        previousMarkerMap[marker.id] = marker
      }
    })

    const normalizedDurationMs = Math.min(
      VEHICLE_MARKER_ANIMATION_MAX_DURATION_MS,
      Math.max(
        VEHICLE_MARKER_ANIMATION_MIN_DURATION_MS,
        Number(animationDurationMs) || VEHICLE_MARKER_ANIMATION_DEFAULT_DURATION_MS
      )
    )

    const movedMarkers = nextVehicleMarkers.filter((marker) => {
      const previousMarker = previousMarkerMap[marker.id]
      if (!previousMarker) {
        return false
      }

      return !this.areNumbersClose(previousMarker.latitude, marker.latitude)
        || !this.areNumbersClose(previousMarker.longitude, marker.longitude)
    })

    if (!movedMarkers.length) {
      this.syncVehicleMarkersToData()
      return
    }

    movedMarkers.forEach((marker) => {
      mapContext.translateMarker({
        markerId: marker.id,
        destination: {
          latitude: marker.latitude,
          longitude: marker.longitude
        },
        autoRotate: true,
        duration: normalizedDurationMs,
        fail: (error) => {
          this.logLocationDebug('translateMarker.fail', {
            markerId: marker.id,
            error: this.toDebugError(error)
          })
          this.syncVehicleMarkersToData()
        }
      })
    })

    this.scheduleVehicleMarkerDataSync(normalizedDurationMs)
  },

  areNumbersClose(left, right, epsilon = MARKER_COORDINATE_EPSILON) {
    if (left === right) {
      return true
    }
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return false
    }
    return Math.abs(left - right) <= epsilon
  },

  hasVehicleMarkerStateChanged(previousMarkers, nextVehicleMarkers) {
    if (previousMarkers.length !== nextVehicleMarkers.length) {
      return true
    }

    const previousMarkerMap = {}
    previousMarkers.forEach((marker) => {
      if (marker) {
        previousMarkerMap[marker.id] = marker
      }
    })

    return nextVehicleMarkers.some((marker) => {
      const previousMarker = previousMarkerMap[marker.id]
      if (!previousMarker) {
        return true
      }

      return !this.areNumbersClose(previousMarker.latitude, marker.latitude)
        || !this.areNumbersClose(previousMarker.longitude, marker.longitude)
        || !this.areNumbersClose(previousMarker.rotation || 0, marker.rotation || 0, MARKER_ANGLE_EPSILON)
        || !this.areNumbersClose(previousMarker.rotate || 0, marker.rotate || 0, MARKER_ANGLE_EPSILON)
    })
  },

  resolveVehicleMarkerAnimationDuration(receivedAt = Date.now()) {
    if (!this.lastVehicleMarkerChangeAt) {
      return VEHICLE_MARKER_ANIMATION_DEFAULT_DURATION_MS
    }

    const gapMs = Math.max(0, receivedAt - this.lastVehicleMarkerChangeAt)
    return Math.min(
      VEHICLE_MARKER_ANIMATION_MAX_DURATION_MS,
      Math.max(
        VEHICLE_MARKER_ANIMATION_MIN_DURATION_MS,
        Math.round(gapMs * VEHICLE_MARKER_ANIMATION_GAP_RATIO)
      )
    )
  },

  getVehicleMarkerMovementThreshold(item) {
    return String((item && item.status) || '').toUpperCase() === 'RUNNING'
      ? MIN_VEHICLE_MARKER_MOVEMENT_DISTANCE_METERS
      : MIN_STOPPED_VEHICLE_MARKER_MOVEMENT_DISTANCE_METERS
  },

  stabilizeVehicleCoordinate(previousMotion, latitude, longitude, item) {
    if (
      !previousMotion
      || previousMotion.latitude === null
      || previousMotion.longitude === null
      || latitude === null
      || longitude === null
    ) {
      return {
        latitude,
        longitude,
        movedDistanceMeters: 0
      }
    }

    const movedDistanceMeters = calculateDistanceMeters(
      previousMotion.latitude,
      previousMotion.longitude,
      latitude,
      longitude
    )

    if (movedDistanceMeters < this.getVehicleMarkerMovementThreshold(item)) {
      return {
        latitude: previousMotion.latitude,
        longitude: previousMotion.longitude,
        movedDistanceMeters
      }
    }

    return {
      latitude,
      longitude,
      movedDistanceMeters
    }
  },

  getAngleDelta(fromAngle, toAngle) {
    let delta = (toAngle - fromAngle) % 360
    if (delta > 180) {
      delta -= 360
    }
    if (delta < -180) {
      delta += 360
    }
    return delta
  },

  buildVehicleAnimationStartMarkers(previousMarkers, nextVehicleMarkers) {
    if (!previousMarkers.length) {
      return nextVehicleMarkers
    }

    const previousMarkerMap = {}
    previousMarkers.forEach((marker) => {
      if (marker) {
        previousMarkerMap[marker.id] = marker
      }
    })

    return nextVehicleMarkers.map((marker) => {
      const previousMarker = previousMarkerMap[marker.id]
      if (!previousMarker) {
        return marker
      }

      return {
        ...marker,
        latitude: previousMarker.latitude,
        longitude: previousMarker.longitude,
        rotation: previousMarker.rotation || 0,
        rotate: previousMarker.rotate || 0
      }
    })
  },

  getVehicleDistanceText(latitude, longitude) {
    if (!this.userLocation || latitude === null || longitude === null) {
      return '\u672a\u5f00\u542f\u7528\u6237\u5b9a\u4f4d'
    }

    const distanceMeters = calculateDistanceMeters(
      this.userLocation.latitude,
      this.userLocation.longitude,
      latitude,
      longitude
    )
    return `\u8ddd\u79bb\u4f60${this.formatDistance(distanceMeters)}`
  },

  refreshVehiclePresentation() {
    const vehicles = (Array.isArray(this.data.vehicles) ? this.data.vehicles : [])
      .filter(Boolean)
      .map(item => ({
        ...item,
        distanceText: this.getVehicleDistanceText(item.latitude, item.longitude)
      }))
    const markers = this.mergeVehicleAndUserMarkers(this.vehicleMarkers)

    this.setData({
      vehicles,
      markers,
      polyline: this.buildDistanceLines(vehicles)
    })
  },

  applyVehicles(vehicles) {
    this.latestVehiclesRaw = this.resolveIncomingVehicleRecords(
      this.dedupeVehiclesById(vehicles)
    )
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
    const previousVehicleMarkers = Array.isArray(this.vehicleMarkers) ? this.vehicleMarkers : []
    const vehicleMarkers = this.buildVehicleMarkers(decoratedVehicles)
    const shouldAnimateVehicleMarkers = this.hasVehicleMarkerStateChanged(previousVehicleMarkers, vehicleMarkers)
    const useNativeAndroidMarkerAnimation = shouldAnimateVehicleMarkers
      && this.canUseNativeVehicleMarkerAnimation(previousVehicleMarkers, vehicleMarkers)
    const animationDurationMs = shouldAnimateVehicleMarkers
      ? this.resolveVehicleMarkerAnimationDuration(receivedAt)
      : 0
    const userMarker = this.buildUserMarker()
    const distanceLines = this.buildDistanceLines(decoratedVehicles)
    this.vehicleMarkers = vehicleMarkers

    const nextState = {
      vehicles: decoratedVehicles,
      polyline: distanceLines
    }

    if (this.shouldResetMapCenter) {
      const firstVehicle = decoratedVehicles.find(item => item.latitude !== null && item.longitude !== null)
      const firstPoint = firstVehicle || userMarker
      nextState.mapLatitude = firstPoint ? firstPoint.latitude : DEFAULT_USER_LOCATION.latitude
      nextState.mapLongitude = firstPoint ? firstPoint.longitude : DEFAULT_USER_LOCATION.longitude
      this.shouldResetMapCenter = false
    }

    if (useNativeAndroidMarkerAnimation) {
      this.lastVehicleMarkerChangeAt = receivedAt
      this.setData(nextState, () => {
        this.animateVehicleMarkersOnAndroid(previousVehicleMarkers, vehicleMarkers, animationDurationMs)
      })
      return
    }

    this.clearVehicleMarkerDataSyncTimer()
    nextState.markers = this.mergeVehicleAndUserMarkers(
      this.isAndroidPlatform() ? vehicleMarkers : this.buildVehicleAnimationStartMarkers(previousVehicleMarkers, vehicleMarkers),
      userMarker
    )

    this.setData(nextState)

    if (shouldAnimateVehicleMarkers && !this.isAndroidPlatform()) {
      this.lastVehicleMarkerChangeAt = receivedAt
      this.animateVehicleMarkers(previousVehicleMarkers, vehicleMarkers, animationDurationMs)
      return
    }

    this.clearVehicleMarkerAnimation()
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
          fontSize: 10,
          padding: 4,
          borderRadius: 12,
          bgColor,
          borderColor: bgColor,
          borderWidth: 1,
          textAlign: 'center',
          anchorX: 0,
          anchorY: -36
        }
      }
    }

    return {
      callout: {
        content,
        display: 'ALWAYS',
        fontSize: 10,
        padding: 4,
        borderRadius: 12,
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
      const primaryVehicle = cluster.items[0]
      const heading = typeof primaryVehicle.heading === 'number' ? primaryVehicle.heading : 0

      return {
        id: this.buildVehicleMarkerId(cluster.items),
        latitude: cluster.latitude,
        longitude: cluster.longitude,
        iconPath: VEHICLE_MARKER_ICON,
        width: cluster.items.length > 1 ? 38 : 34,
        height: cluster.items.length > 1 ? 38 : 34,
        rotation: heading,
        rotate: heading,
        anchor: {
          x: 0.5,
          y: 0.5
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

  computeVehicleHeading(previousMotion, latitude, longitude) {
    if (
      !previousMotion
      || previousMotion.latitude === null
      || previousMotion.longitude === null
      || latitude === null
      || longitude === null
      || (previousMotion.latitude === latitude && previousMotion.longitude === longitude)
    ) {
      return previousMotion && typeof previousMotion.heading === 'number'
        ? previousMotion.heading
        : 0
    }

    const movedDistanceMeters = calculateDistanceMeters(
      previousMotion.latitude,
      previousMotion.longitude,
      latitude,
      longitude
    )
    if (movedDistanceMeters < MIN_VEHICLE_HEADING_UPDATE_DISTANCE_METERS) {
      return previousMotion && typeof previousMotion.heading === 'number'
        ? previousMotion.heading
        : 0
    }

    const startLatitude = previousMotion.latitude * Math.PI / 180
    const endLatitude = latitude * Math.PI / 180
    const deltaLongitude = (longitude - previousMotion.longitude) * Math.PI / 180
    const y = Math.sin(deltaLongitude) * Math.cos(endLatitude)
    const x = Math.cos(startLatitude) * Math.sin(endLatitude)
      - Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(deltaLongitude)
    const bearing = Math.atan2(y, x) * 180 / Math.PI
    return (bearing + 360) % 360
  },

  decorateVehicle(item, receivedAt = Date.now()) {
    const normalizedCoordinate = this.normalizeCoordinatePair(item.latitude, item.longitude)
    const previousMotion = this.vehicleMotionMap[item.vehicleId] || null
    const stabilizedCoordinate = this.stabilizeVehicleCoordinate(
      previousMotion,
      normalizedCoordinate.latitude,
      normalizedCoordinate.longitude,
      item
    )
    const latitude = stabilizedCoordinate.latitude
    const longitude = stabilizedCoordinate.longitude
    const speed = resolveVehicleCurrentSpeed({
      latitude: normalizedCoordinate.latitude,
      longitude: normalizedCoordinate.longitude,
      speed: item.speed,
      updateTime: item.updateTime,
      status: item.status
    }, previousMotion, receivedAt)
    const heading = this.computeVehicleHeading(previousMotion, latitude, longitude)
    this.vehicleMotionMap[item.vehicleId] = buildVehicleMotionSnapshot(
      item,
      latitude,
      longitude,
      speed,
      receivedAt,
      heading,
      normalizedCoordinate.latitude,
      normalizedCoordinate.longitude
    )
    return {
      ...item,
      latitude,
      longitude,
      heading,
      status: item.status || 'UNKNOWN',
      distanceText: this.getVehicleDistanceText(latitude, longitude),
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
}

module.exports = Object.assign({}, module.exports, socketModule, locationModule)
