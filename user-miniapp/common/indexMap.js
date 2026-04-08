const { calculateDistanceMeters } = require('./vehicleState')

const VEHICLE_MARKER_ICON = '/assets/bus-marker.png'
const USER_MARKER_ICON = '/assets/user-marker.png'
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

module.exports = {
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

    return clusters.map((cluster) => {
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
  }
}
