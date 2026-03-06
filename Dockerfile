FROM node:jod-alpine

ENV LANG="C.UTF-8" \
    PS1="$(whoami)@$(hostname):$(pwd)$ " \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES=1 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_SERVICES_GRACETIME=10000 \
    TERM="xterm-256color"

COPY . /app/ring-mqtt
RUN S6_VERSION="v3.2.1.0" && \
    BASHIO_VERSION="v0.17.5" && \
    APK_ARCH="$(apk --print-arch)" && \
    apk add --no-cache tar xz git bash curl jq tzdata && \
    curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/${S6_VERSION}/s6-overlay-noarch.tar.xz" | tar -Jxpf - -C / && \
    case "${APK_ARCH}" in \
        aarch64|armhf|x86_64) \
            curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/${S6_VERSION}/s6-overlay-${APK_ARCH}.tar.xz" | tar Jxpf - -C / ;; \
        armv7) \
            curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/${S6_VERSION}/s6-overlay-arm.tar.xz" | tar Jxpf - -C / ;; \
        *) \
            echo >&2 "ERROR: Unsupported architecture '$APK_ARCH'" \
            exit 1;; \
    esac && \
    mkdir -p /etc/fix-attrs.d && \
    mkdir -p /etc/services.d && \
    cp -a /app/ring-mqtt/init/s6/* /etc/. && \
    chmod +x /etc/cont-init.d/*.sh && \
    chmod +x /etc/services.d/ring-mqtt/* && \
    rm -Rf /app/ring-mqtt/init && \
    curl -J -L -o /tmp/bashio.tar.gz "https://github.com/hassio-addons/bashio/archive/${BASHIO_VERSION}.tar.gz" && \
    mkdir /tmp/bashio && \
    tar zxvf /tmp/bashio.tar.gz --strip 1 -C /tmp/bashio && \
    mv /tmp/bashio/lib /usr/lib/bashio && \
    ln -s /usr/lib/bashio/bashio /usr/bin/bashio && \
    chmod +x /app/ring-mqtt/scripts/*.sh && \
    mkdir /data && \
    chmod 777 /data /app /run && \
    cd /app/ring-mqtt && \
    chmod +x ring-mqtt.js && \
    chmod +x init-ring-mqtt.js && \
    npm install && \
    rm -Rf /root/.npm && \
    rm -f -r /tmp/*
ENTRYPOINT [ "/init" ]

EXPOSE 55123/tcp

ARG BUILD_VERSION
ARG BUILD_DATE

LABEL \
    io.hass.name="Ring-MQTT" \
    io.hass.description="Home Assistant Community Add-on for Ring Devices without Streaming capabilities" \
    io.hass.type="addon" \
    io.hass.version=${BUILD_VERSION} \
    maintainer="Nicolas Cerveaux" \
    org.opencontainers.image.title="Ring-MQTT" \
    org.opencontainers.image.description="Security-hardened Ring MQTT bridge (no streaming)" \
    org.opencontainers.image.authors="Nicolas Cerveaux, Tom Sightler" \
    org.opencontainers.image.licenses="MIT" \
    org.opencontainers.image.source="https://github.com/thoughtminers/ring-mqtt" \
    org.opencontainers.image.documentation="https://github.com/thoughtminers/ring-mqtt#readme" \
    org.opencontainers.image.created=${BUILD_DATE} \
    org.opencontainers.image.version=${BUILD_VERSION}
