const {
  calculateDistanceMeters,
  parseUpdateTimeToTimestamp,
  resolveVehicleCurrentSpeed,
  buildVehicleMotionSnapshot
} = require('./vehicleState')

const MIN_VEHICLE_HEADING_UPDATE_DISTANCE_METERS = 5

module.exports = {
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
      nextState.mapLatitude = firstPoint ? firstPoint.latitude : this.getDefaultUserLocation().latitude
      nextState.mapLongitude = firstPoint ? firstPoint.longitude : this.getDefaultUserLocation().longitude
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
  }
}
