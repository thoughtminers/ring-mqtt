import RingPolledDevice from './base-polled-device.js'
import utils from '../lib/utils.js'
import chalk from 'chalk'

export default class Camera extends RingPolledDevice {
    constructor(deviceInfo, events) {
        super(deviceInfo, 'camera')

        const savedState = this.getSavedState()

        this.hasBattery1 = Boolean(this.device.data.hasOwnProperty('battery_voltage'))
        this.hasBattery2 = Boolean(this.device.data.hasOwnProperty('battery_voltage_2'))

        this.hevcEnabled = this.device.data?.settings?.video_settings?.hevc_enabled
            ? this.device.data.settings.video_settings.hevc_enabled
            : false

        this.data = {
            motion: {
                active_ding: false,
                duration: savedState?.motion?.duration ? savedState.motion.duration : 180,
                publishedDuration: false,
                last_ding: 0,
                last_ding_expires: 0,
                last_ding_time: 'none',
                is_person: false,
                detection_enabled: null,
                warning_enabled: null,
                events: events.filter(event => event.event_type === 'motion'),
                latestEventId: ''
            },
            ...this.device.isDoorbot ? {
                ding: {
                    active_ding: false,
                    duration: savedState?.ding?.duration ? savedState.ding.duration : 180,
                    publishedDurations: false,
                    last_ding: 0,
                    last_ding_expires: 0,
                    last_ding_time: 'none',
                    events: events.filter(event => event.event_type === 'ding'),
                    latestEventId: ''
                }
            } : {},
            snapshot: {
                mode: savedState?.snapshot?.mode
                    ?  savedState.snapshot.mode.replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())
                    : 'Auto',
                ding: false,
                motion: false,
                interval: false,
                autoInterval: savedState?.snapshot?.autoInterval
                    ? savedState.snapshot.autoInterval
                    : true,
                intervalDuration: savedState?.snapshot?.intervalDuration
                    ? savedState.snapshot.intervalDuration
                    : (this.device.operatingOnBattery) ? 600 : 30,
                intervalTimerId: null,
                cache: null,
                cacheType: null,
                timestamp: null,
                onDemandTimestamp: 0
            },
            ...this.device.hasLight ? {
                light: {
                    state: null,
                    setTime: Math.floor(Date.now()/1000)
                }
            } : {},
            ...this.device.hasSiren ? {
                siren: {
                    state: null
                }
            } : {}
        }

        this.entity = {
            ...this.entity,
            motion: {
                component: 'binary_sensor',
                device_class: 'motion',
                attributes: true
            },
            ...this.device.isDoorbot ? {
                ding: {
                    component: 'binary_sensor',
                    device_class: 'occupancy',
                    attributes: true,
                    icon: 'mdi:doorbell-video'
                }
            } : {},
            ...this.device.hasLight ? {
                light: {
                    component: 'light'
                }
            } : {},
            ...this.device.hasSiren ? {
                siren: {
                    component: 'switch',
                    icon: 'mdi:alarm-light'
                }
            } : {},
            snapshot: {
                component: 'camera',
                attributes: true
            },
            snapshot_mode: {
                component: 'select',
                category: 'config',
                options: [
                    ...this.device.isDoorbot
                        ? [
                            'All', 'Auto', 'Ding', 'Interval', 'Interval + Ding',
                            'Interval + Motion', 'Motion', 'Motion + Ding', 'Disabled'
                        ]
                        : [ 'All', 'Auto', 'Interval', 'Motion', 'Disabled' ]
                ]
            },
            snapshot_interval: {
                component: 'number',
                category: 'config',
                min: 10,
                max: 604800,
                mode: 'box',
                icon: 'hass:timer'
            },
            take_snapshot: {
                component: 'button',
                icon: 'mdi:camera'
            },
            motion_detection: {
                component: 'switch',
                category: 'config'
            },
            ...this.device.data.features?.motion_message_enabled ? {
                motion_warning: {
                    component: 'switch',
                    category: 'config'
                }
            } : {},
            motion_duration: {
                component: 'number',
                category: 'config',
                min: 10,
                max: 180,
                mode: 'box',
                icon: 'hass:timer'
            },
            ...this.device.isDoorbot ? {
                ding_duration: {
                    component: 'number',
                    category: 'config',
                    min: 10,
                    max: 180,
                    icon: 'hass:timer'
                }
            } : {},
            info: {
                component: 'sensor',
                category: 'diagnostic',
                device_class: 'timestamp',
                value_template: '{{ value_json["lastUpdate"] | default("") }}'
            }
        }

        this.device.onNewNotification.subscribe(notification => {
            this.processNotification(notification)
        })

        this.updateSnapshotMode()
        this.scheduleSnapshotRefresh()

        this.updateDeviceState()
    }

    updateDeviceState() {
        const stateData = {
            snapshot: {
                mode: this.data.snapshot.mode,
                autoInterval: this.data.snapshot.autoInterval,
                interval: this.data.snapshot.intervalDuration
            },
            motion: {
                duration: this.data.motion.duration
            },
            ...this.device.isDoorbot ? {
                ding: {
                    duration: this.data.ding.duration
                }
            } : {}
        }
        this.setSavedState(stateData)
    }

    // Build standard and optional entities for device
    async initAttributeEntities() {
         // If device is wireless publish signal strength entity
        const deviceHealth = await this.device.getHealth()
        if (deviceHealth && !(deviceHealth?.network_connection && deviceHealth.network_connection === 'ethernet')) {
            this.entity.wireless = {
                component: 'sensor',
                category: 'diagnostic',
                device_class: 'signal_strength',
                unit_of_measurement: 'dBm',
                parent_state_topic: 'info/state',
                attributes: 'wireless',
                value_template: '{{ value_json["wirelessSignal"] | default("") }}'
            }
        }

        // If device is battery powered publish battery entity
        if (this.device.batteryLevel || this.hasBattery1 || this.hasBattery2) {
            this.entity.battery = {
                component: 'sensor',
                category: 'diagnostic',
                device_class: 'battery',
                unit_of_measurement: '%',
                state_class: 'measurement',
                parent_state_topic: 'info/state',
                attributes: 'battery',
                value_template: '{{ value_json["batteryLevel"] | default("") }}'
            }
        }

        // If no motion events in device event cache, request recent motion events
        if (this.data.motion.events.length === 0) {
            const response = await this.getDeviceHistory({limit: 5, event_types: 'motion'})
            if (Array.isArray(response?.items) && response.items.length > 0) {
                this.data.motion.events = response.items
            }
        }

        if (this.data.motion.events.length > 0) {
            const lastMotionEvent = this.data.motion.events[0]
            const lastMotionDate = lastMotionEvent?.start_time ? new Date(lastMotionEvent.start_time) : false
            this.data.motion.last_ding = lastMotionDate ? Math.floor(lastMotionDate/1000) : 0
            this.data.motion.last_ding_time = lastMotionDate ? utils.getISOTime(lastMotionDate) : ''
            this.data.motion.is_person = Boolean(lastMotionEvent?.cv?.person_detected)
            this.data.motion.latestEventId = lastMotionEvent.event_id

        } else {
            this.debug('Unable to retrieve most recent motion event for this camera')
        }

        // Get most recent ding event data
        if (this.device.isDoorbot) {
            // If no ding events in device event cache, request recent ding events
            if (this.data.ding.events.length === 0) {
                const response = await this.getDeviceHistory({limit: 5, event_types: 'ding'})
                if (Array.isArray(response?.items) && response.items.length > 0) {
                    this.data.ding.events = response.items
                }
            }

            if (this.data.ding.events.length > 0) {
                const lastDingEvent = this.data.ding.events[0]
                const lastDingDate = lastDingEvent?.start_time ? new Date(lastDingEvent.start_time) : false
                this.data.ding.last_ding = lastDingDate ? Math.floor(lastDingDate/1000) : 0
                this.data.ding.last_ding_time = lastDingDate ? utils.getISOTime(lastDingDate) : ''
                this.data.ding.latestEventId = lastDingEvent.event_id
            } else {
                this.debug('Unable to retrieve most recent ding event for this doorbell')
            }
        }

    }

    updateSnapshotMode() {
        this.data.snapshot.ding = Boolean(this.device.isDoorbot && this.data.snapshot.mode.match(/(ding|^all|auto$)/i))
        this.data.snapshot.motion = Boolean(this.data.snapshot.mode.match(/(motion|^all|auto$)/i))

        this.data.snapshot.interval = this.data.snapshot.mode === 'Auto'
            ? Boolean(!this.device.operatingOnBattery)
            : Boolean(this.data.snapshot.mode.match(/(interval|^all$)/i))

        if (this.data.snapshot.interval && this.data.snapshot.autoInterval) {
            // If interval snapshots are enabled but interval is not manually set, try to detect a reasonable defaults
            if (this.device.operatingOnBattery) {
                if (this.device.data.settings.lite_24x7?.enabled) {
                    this.data.snapshot.intervalDuration = this.device.data.settings.lite_24x7.frequency_secs
                } else {
                    this.data.snapshot.intervalDuration = 600
                }
            } else {
                // For wired cameras default to 30 seconds
                this.data.snapshot.intervalDuration = 30
            }
        }
    }

    // Publish camera capabilities and state and subscribe to events
    async publishState(data) {
        const isPublish = Boolean(data === undefined)
        this.publishPolledState(isPublish)

        if (isPublish) {
            this.publishDingStates()
            this.publishDingDurationState(isPublish)
            this.publishSnapshotMode()
            if (this.data.snapshot.motion || this.data.snapshot.ding || this.data.snapshot.interval) {
                this.data.snapshot.cache ? this.publishSnapshot() : this.refreshSnapshot('interval')
                this.publishSnapshotInterval(isPublish)
            }
            this.publishAttributes()
        }

        // Check for subscription to ding and motion events and attempt to resubscribe
        if (this.device.isDoorbot && !this.device.data.subscribed === true) {
            this.debug('Camera lost subscription to ding events, attempting to resubscribe...')
            this.device.subscribeToDingEvents().catch(e => {
                this.debug('Failed to resubscribe camera to ding events. Will retry in 60 seconds.')
                this.debug(e)
            })
        }
        if (!this.device.data.subscribed_motions === true) {
            this.debug('Camera lost subscription to motion events, attempting to resubscribe...')
            this.device.subscribeToMotionEvents().catch(e => {
                this.debug('Failed to resubscribe camera to motion events.  Will retry in 60 seconds.')
                this.debug(e)
            })
        }
    }

    // Process a ding event
    async processNotification(pushData) {
        let dingKind
        // Is it a motion or doorbell ding? (for others we do nothing)
        switch (pushData.android_config?.category) {
            case 'com.ring.pn.live-event.ding':
                dingKind = 'ding'
                break
            case 'com.ring.pn.live-event.motion':
                dingKind = 'motion'
                break
            default:
                this.debug(`Received push notification of unknown type ${pushData.action}`)
                return
        }
        this.debug(`Received ${dingKind} push notification, expires in ${this.data[dingKind].duration} seconds`)

        // Is this a new Ding or refresh of active ding?
        const newDing = Boolean(!this.data[dingKind].active_ding)
        this.data[dingKind].active_ding = true

        // Update last_ding and expire time
        this.data[dingKind].last_ding = Math.floor(pushData.data?.event?.eventito?.timestamp/1000)
        this.data[dingKind].last_ding_time = pushData.data?.event?.ding?.created_at
        this.data[dingKind].last_ding_expires = this.data[dingKind].last_ding+this.data[dingKind].duration

        // If motion ding and snapshots on motion are enabled, publish a new snapshot
        if (dingKind === 'motion') {
            this.data[dingKind].is_person = Boolean(pushData.data?.event?.ding?.detection_type === 'human')
            if (this.data.snapshot.motion) {
                this.refreshSnapshot('motion', pushData?.img?.snapshot_uuid)
            }
        } else if (this.data.snapshot.ding) {
            // If doorbell press and snapshots on ding are enabled, publish a new snapshot
            this.refreshSnapshot('ding', pushData?.img?.snapshot_uuid)
        }

        // Publish MQTT active sensor state
        // Will republish to MQTT for new dings even if ding is already active
        this.publishDingState(dingKind)

        // If new ding, begin expiration loop (only needed for first ding as others just extend time)
        if (newDing) {
            // Loop until current time is > last_ding expires time.  Sleeps until
            // estimated expire time, but may loop if new dings increase last_ding_expires
            while (Math.floor(Date.now()/1000) < this.data[dingKind].last_ding_expires) {
                const sleeptime = (this.data[dingKind].last_ding_expires - Math.floor(Date.now()/1000)) + 1
                await utils.sleep(sleeptime)
            }
            // All dings have expired, set ding state back to false/off and publish
            this.debug(`All ${dingKind} dings for camera have expired`)
            this.data[dingKind].active_ding = false
            this.publishDingState(dingKind)
        }
    }

    // Publishes all current ding states for this camera
    publishDingStates() {
        this.publishDingState('motion')
        if (this.device.isDoorbot) {
            this.publishDingState('ding')
        }
    }

    // Publish ding state and attributes
    publishDingState(dingKind) {
        const dingState = this.data[dingKind].active_ding ? 'ON' : 'OFF'
        this.mqttPublish(this.entity[dingKind].state_topic, dingState)

        if (dingKind === 'motion') {
            this.publishMotionAttributes()
        } else {
            this.publishDingAttributes()
        }
    }

    publishMotionAttributes() {
        const attributes = {
            lastMotion: this.data.motion.last_ding,
            lastMotionTime: this.data.motion.last_ding_time,
            personDetected: this.data.motion.is_person
        }
        if (this.device.data.settings && typeof this.device.data.settings.motion_detection_enabled !== 'undefined') {
            this.data.motion.detection_enabled = this.device.data.settings.motion_detection_enabled
            attributes.motionDetectionEnabled = this.data.motion.detection_enabled
        }
        this.mqttPublish(this.entity.motion.json_attributes_topic, JSON.stringify(attributes), 'attr')
    }

    publishDingAttributes() {
        const attributes = {
            lastDing: this.data.ding.last_ding,
            lastDingTime: this.data.ding.last_ding_time
        }
        this.mqttPublish(this.entity.ding.json_attributes_topic, JSON.stringify(attributes), 'attr')
    }

    // Publish camera state for polled attributes (light/siren state, etc)
    // Writes state to custom property to keep from publishing state except
    // when values change from previous polling interval
    publishPolledState(isPublish) {
        if (this.device.hasLight) {
            const lightState = this.device.data.led_status === 'on' ? 'ON' : 'OFF'
            if ((lightState !== this.data.light.state && Date.now()/1000 - this.data.light.setTime > 30) || isPublish) {
                this.data.light.state = lightState
                this.mqttPublish(this.entity.light.state_topic, this.data.light.state)
            }
        }
        if (this.device.hasSiren) {
            const sirenState = this.device.data.siren_status.seconds_remaining > 0 ? 'ON' : 'OFF'
            if (sirenState !== this.data.siren.state || isPublish) {
                this.data.siren.state = sirenState
                this.mqttPublish(this.entity.siren.state_topic, this.data.siren.state)
            }
        }

        // Publish motion switch settings and attributes
        if (this.device.data.settings.motion_detection_enabled !== this.data.motion.detection_enabled || isPublish) {
            this.publishMotionAttributes()
            this.mqttPublish(this.entity.motion_detection.state_topic, this.device.data?.settings?.motion_detection_enabled ? 'ON' : 'OFF')
        }

        if (this.entity.hasOwnProperty('motion_warning') && (this.device.data.settings.motion_announcement !== this.data.motion.warning_enabled || isPublish)) {
            this.mqttPublish(this.entity.motion_warning.state_topic, this.device.data.settings.motion_announcement ? 'ON' : 'OFF')
            this.data.motion.warning_enabled = this.device.data.settings.motion_announcement
        }
    }

    // Publish device data to info topic
    async publishAttributes() {
        const attributes = {}
        const deviceHealth = await this.device.getHealth()

        if (this.device.batteryLevel || this.hasBattery1 || this.hasBattery2) {
            if (deviceHealth && deviceHealth.hasOwnProperty('active_battery')) {
                attributes.activeBattery = deviceHealth.active_battery
            }

            // Reports the level of the currently active battery, might be null if removed so report 0% in that case
            attributes.batteryLevel = this.device.batteryLevel && utils.isNumeric(this.device.batteryLevel)
                ? this.device.batteryLevel
                : 0

            // Must have at least one battery, but it might not be inserted, so report 0% in that case
            attributes.batteryLife = this.device.data.hasOwnProperty('battery_life') && utils.isNumeric(this.device.data.battery_life)
                ? Number.parseFloat(this.device.data.battery_life)
                : 0

            if (this.hasBattery2) {
                attributes.batteryLife2 = this.device.data.hasOwnProperty('battery_life_2') && utils.isNumeric(this.device.data.battery_life_2)
                    ? Number.parseFloat(this.device.data.battery_life_2)
                    : 0
            }
        }

        if (deviceHealth) {
            attributes.firmwareStatus = deviceHealth.firmware
            attributes.lastUpdate = deviceHealth.updated_at.slice(0,-6)+"Z"
            if (deviceHealth.hasOwnProperty('network_connection') && deviceHealth.network_connection === 'ethernet') {
                attributes.wiredNetwork = this.device.data.alerts.connection
            } else {
                attributes.wirelessNetwork = deviceHealth.wifi_name
                attributes.wirelessSignal = deviceHealth.latest_signal_strength
            }
        }

        if (Object.keys(attributes).length > 0) {
            this.mqttPublish(this.entity.info.state_topic, JSON.stringify(attributes), 'attr')
            this.publishAttributeEntities(attributes)
        }
    }

    publishSnapshotInterval(isPublish) {
        if (isPublish) {
            this.mqttPublish(this.entity.snapshot_interval.state_topic, this.data.snapshot.intervalDuration.toString())
        } else {
            // Update snapshot frequency in case it's changed
            if (this.data.snapshot.autoInterval && this.data.snapshot.intervalDuration !== this.device.data.settings.lite_24x7.frequency_secs) {
                this.data.snapshot.intervalDuration = this.device.data.settings.lite_24x7.frequency_secs
                clearInterval(this.data.snapshot.intervalTimerId)
                this.scheduleSnapshotRefresh()
            }
            this.mqttPublish(this.entity.snapshot_interval.state_topic, this.data.snapshot.intervalDuration.toString())
        }
    }

    publishSnapshotMode() {
        this.mqttPublish(this.entity.snapshot_mode.state_topic, this.data.snapshot.mode)
    }

    publishDingDurationState(isPublish) {
        const dingTypes = this.device.isDoorbot ? [ 'ding', 'motion' ] : [ 'motion' ]
        dingTypes.forEach(dingType => {
            if (this.data[dingType].duration !== this.data[dingType].publishedDuration || isPublish) {
                this.mqttPublish(this.entity[`${dingType}_duration`].state_topic, this.data[dingType].duration)
                this.data[dingType].publishedDuration = this.data[dingType].duration
            }
        })
    }

    // Publish snapshot image/metadata
    publishSnapshot() {
        this.mqttPublish(this.entity.snapshot.topic, this.data.snapshot.cache, 'mqtt', '<binary_image_data>')
        const attributes = {
            timestamp: this.data.snapshot.timestamp,
            type: this.data.snapshot.cacheType
        }
        this.mqttPublish(this.entity.snapshot.json_attributes_topic, JSON.stringify(attributes), 'attr')
    }

    // Refresh snapshot on scheduled interval
    scheduleSnapshotRefresh() {
        this.data.snapshot.intervalTimerId = setInterval(() => {
            if (this.isOnline() && this.data.snapshot.interval && !(this.data.snapshot.motion && this.data.motion.active_ding)) {
                this.refreshSnapshot('interval')
            }
        }, this.data.snapshot.intervalDuration * 1000)
    }

    async refreshSnapshot(type, image_uuid) {
        let newSnapshot = false
        let loop = 3

        if (this.device.snapshotsAreBlocked) {
            this.debug('Snapshots are unavailable, check if motion capture is disabled manually or via modes settings')
            return
        }

        while (!newSnapshot && loop > 0) {
            try {
                switch (type) {
                    case 'interval':
                    case 'on-demand':
                        this.debug(`Requesting an updated ${type} snapshot`)
                        newSnapshot = await this.device.getNextSnapshot({ force: true })
                        break;
                    case 'motion':
                    case 'ding':
                        if (image_uuid) {
                            this.debug(`Requesting ${type} snapshot using notification image UUID: ${image_uuid}`)
                            newSnapshot = await this.device.getNextSnapshot({ uuid: image_uuid })
                        } else if (!this.device.operatingOnBattery) {
                            this.debug(`Requesting an updated ${type} snapshot`)
                            newSnapshot = await this.device.getNextSnapshot({ force: true })
                        } else {
                            this.debug(`The ${type} notification did not contain image UUID and battery cameras are unable to snapshot while recording`)
                            loop = 0  // Don't retry in this case
                        }
                        break;
                }
            } catch (err) {
                this.debug(err)
                if (loop > 1) {
                    this.debug(`Failed to retrieve updated ${type} snapshot, retrying in one second...`)
                    await utils.sleep(1)
                } else {
                    this.debug(`Failed to retrieve updated ${type} snapshot after three attempts, aborting`)
                }
            }
            loop--
        }

        if (newSnapshot) {
            this.debug(`Successfully retrieved updated ${type} snapshot`)
            this.data.snapshot.cache = newSnapshot
            this.data.snapshot.cacheType = type
            this.data.snapshot.timestamp = Math.round(Date.now()/1000)
            this.publishSnapshot()
        }
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        const entityKey = command.split('/')[0]
        if (!this.entity.hasOwnProperty(entityKey)) {
            this.debug(`Received message to unknown command topic: ${command}`)
            return
        }

        switch (command) {
            case 'light/command':
                this.setLightState(message)
                break;
            case 'siren/command':
                this.setSirenState(message)
                break;
            case 'snapshot_mode/command':
                this.setSnapshotMode(message)
                break;
            case 'snapshot_interval/command':
                this.setSnapshotInterval(message)
                break;
            case 'take_snapshot/command':
                this.takeSnapshot(message)
                break;
            case 'ding_duration/command':
                this.setDingDuration(message, 'ding')
                break;
            case 'motion_detection/command':
                this.setMotionDetectionState(message)
                break;
            case 'motion_warning/command':
                this.setMotionWarningState(message)
                break;
            case 'motion_duration/command':
                this.setDingDuration(message, 'motion')
                break;
        }
    }

    // Set switch target state on received MQTT command message
    async setLightState(message) {
        this.debug(`Received set light state ${message}`)
        const command = message.toLowerCase()

        switch (command) {
            case 'on':
            case 'off':
                this.data.light.setTime = Math.floor(Date.now()/1000)
                await this.device.setLight(Boolean(command === 'on'))
                this.data.light.state = command.toUpperCase()
                this.mqttPublish(this.entity.light.state_topic, this.data.light.state)
                break;
            default:
                this.debug('Received unknown command for light')
        }
    }

    // Set switch target state on received MQTT command message
    async setSirenState(message) {
        this.debug(`Received set siren state ${message}`)
        const command = message.toLowerCase()

        switch (command) {
            case 'on':
            case 'off':
                await this.device.setSiren(Boolean(command === 'on'))
                break;
            default:
                this.debug('Received unknown command for siren')
        }
    }

    // Set switch target state on received MQTT command message
    async setMotionDetectionState(message) {
        this.debug(`Received set motion detection state ${message}`)
        const command = message.toLowerCase()
        try {
            switch (command) {
                case 'on':
                case 'off':
                    await this.device.setDeviceSettings({
                        "motion_settings": {
                            "motion_detection_enabled": Boolean(command === 'on')
                        }
                    })
                    break;
                default:
                    this.debug('Received unknown command for motion detection state')
            }
        } catch(err) {
            if (err.message === 'Response code 404 (Not Found)') {
                this.debug('Shared accounts cannot change motion detection settings!')
            } else {
                this.debug(chalk.yellow(err.message))
                this.debug(err.stack)
            }
        }
    }

    // Set switch target state on received MQTT command message
    async setMotionWarningState(message) {
        this.debug(`Received set motion warning state ${message}`)
        const command = message.toLowerCase()
        try {
            switch (command) {
                case 'on':
                case 'off':
                    await this.device.restClient.request({
                        method: 'PUT',
                        url: this.device.doorbotUrl(`motion_announcement?motion_announcement=${Boolean(command === 'on')}`)
                    })
                    this.mqttPublish(this.entity.motion_warning.state_topic, command === 'on' ? 'ON' : 'OFF')
                    this.data.motion.warning_enabled = Boolean(command === 'on')
                    break;
                default:
                    this.debug('Received unknown command for motion warning state')
            }
        } catch(err) {
            if (err.message === 'Response code 404 (Not Found)') {
                this.debug('Shared accounts cannot change motion warning settings!')
            } else {
                this.debug(chalk.yellow(err.message))
                this.debug(err.stack)
            }
        }
    }

    // Set refresh interval for snapshots
    setSnapshotInterval(message) {
        this.debug(`Received set snapshot refresh interval ${message}`)
        if (isNaN(message)) {
            this.debug('Snapshot interval value received but not a number')
        } else if (!(message >= 10 && message <= 604800)) {
            this.debug('Snapshot interval value received but out of range (10-604800)')
        } else {
            this.data.snapshot.intervalDuration = Math.round(message)
            this.data.snapshot.autoInterval = false
            if (this.data.snapshot.mode === 'Auto') {
                // Creates an array containing only currently active snapshot modes
                const activeModes =
                    (this.device.isDoorbot ? ['Interval', 'Motion', 'Ding'] : ['Interval', 'Motion'])
                        .filter(e => this.data.snapshot[e.toLowerCase()])
                this.data.snapshot.mode = activeModes.length === 0
                    ? 'Disabled' // No snapshot modes are active
                    : activeModes.length === (this.device.isDoorbot ? 3 : 2)
                        ? 'All' // All snapshot modes this device supports are active
                        : activeModes.join(' + ') // Some snapshot modes this device supports are active
                this.updateSnapshotMode()
                this.publishSnapshotMode()
            }
            clearInterval(this.data.snapshot.intervalTimerId)
            this.scheduleSnapshotRefresh()
            this.publishSnapshotInterval()
            this.debug('Snapshot refresh interval has been set to '+this.data.snapshot.intervalDuration+' seconds')
            this.updateDeviceState()
        }
    }

    takeSnapshot(message) {
        if (message.toLowerCase() === 'press') {
            this.debug('Received command to take an on-demand snapshot')
            if (this.data.snapshot.onDemandTimestamp + 10 > Math.round(Date.now()/1000 ) ) {
                this.debug('On-demand snapshots are limited to one snapshot every 10 seconds')
            } else {
                this.data.snapshot.onDemandTimestamp = Math.round(Date.now()/1000)
                this.refreshSnapshot('on-demand')
            }
        } else {
            this.debug(`Received invalid command via on-demand snapshot topic: ${message}`)
        }
    }

    setSnapshotMode(message) {
        this.debug(`Received set snapshot mode to ${message}`)
        const snapshotMode = message.toLowerCase().replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())

        if (this.entity.snapshot_mode.options.map(o => o.includes(snapshotMode))) {
            this.data.snapshot.mode = snapshotMode
            this.data.snapshot.autoInterval = snapshotMode === 'Auto' ? true : this.data.snapshot.autoInterval
            this.updateSnapshotMode()
            this.publishSnapshotMode()

            if (snapshotMode === 'Auto') {
                this.debug(`Snapshot mode has been set to ${snapshotMode}, resetting to default values for camera type`)
                clearInterval(this.data.snapshot.intervalTimerId)
                this.scheduleSnapshotRefresh()
                this.publishSnapshotInterval()
            } else {
                this.debug(`Snapshot mode has been set to ${snapshotMode}`)
            }

            this.updateDeviceState()
        } else {
            this.debug(`Received invalid command for snapshot mode`)
        }
}

    setDingDuration(message, dingType) {
        this.debug(`Received set notification duration for ${dingType} events`)
        if (isNaN(message)) {
            this.debug(`New ${dingType} event notificaiton duration value received but is not a number`)
        } else if (!(message >= 10 && message <= 180)) {
            this.debug(`New ${dingType} event notification duration value received but out of range (10-180)`)
        } else {
            this.data[dingType].duration = Math.round(message)
            this.publishDingDurationState()
            this.debug(`Notificaition duration for ${dingType} events has been set to ${this.data[dingType].duration} seconds`)
            this.updateDeviceState()
        }
    }
}
