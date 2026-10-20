package ru.sadzvuka.songs

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.*

class MetronomeService : Service() {
    companion object {
        const val START = "ru.sadzvuka.songs.METRONOME_START"
        const val STOP = "ru.sadzvuka.songs.METRONOME_STOP"
        private const val CHANNEL = "songs_metronome"
        private const val NOTIFICATION = 7341
        var instance: MetronomeService? = null
            private set
    }
    private var engine: MetronomeEngine? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val main = Handler(Looper.getMainLooper())
    private var activeGeneration: Long = -1

    override fun onCreate() {
        super.onCreate()
        instance = this
        if (Build.VERSION.SDK_INT >= 26) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL, "Метроном", NotificationManager.IMPORTANCE_LOW)
                    .apply { description = "Работающий метроном и кнопка остановки"; setSound(null, null) }
            )
        }
    }

    private fun notification(): Notification {
        val config = MetronomeBridge.settings
        val launch = PendingIntent.getActivity(this, 1,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 2,
            Intent(this, MetronomeService::class.java).setAction(STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL)
            else Notification.Builder(this)
        return builder.setSmallIcon(R.drawable.ic_metronome)
            .setContentTitle("Метроном · ${config.bpm} BPM")
            .setContentText("${config.rhythm.name} · ${config.beats} долей")
            .setContentIntent(launch).setOngoing(true).setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .addAction(Notification.Action.Builder(null, "Остановить", stop).build())
            .build()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) {
            MetronomeBridge.stop(this)
            stopSelf()
            return START_NOT_STICKY
        }
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification(),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(NOTIFICATION, notification())
        val token = intent?.getLongExtra("generation", -1) ?: -1
        if (!MetronomeBridge.desiredRunning || token != MetronomeBridge.generation.get()) {
            if (!MetronomeBridge.desiredRunning) stopSelf()
            return START_NOT_STICKY
        }
        stopSound()
        activeGeneration = token
        val power = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Songs:Metronome")
            .apply { setReferenceCounted(false); acquire() }
        engine = MetronomeEngine(MetronomeBridge.settings,
            onBeat = { beat, frame -> MetronomeBridge.emitBeat(beat, frame, token) },
            onError = { main.post {
                if (token == MetronomeBridge.generation.get()) {
                    MetronomeBridge.stop(this)
                    MetronomeBridge.publish(false, error = "Не удалось воспроизвести метроном. Повторите запуск.")
                    stopSelf()
                }
            } })
        engine?.start()
        return START_NOT_STICKY
    }

    fun update(config: MetronomeSettings) {
        engine?.update(config)
        if (engine != null) getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION, notification())
    }

    fun stopSound() {
        engine?.stop()
        engine = null
        if (wakeLock?.isHeld == true) wakeLock?.release()
        wakeLock = null
    }

    override fun onDestroy() {
        stopSound()
        if (instance === this) instance = null
        if (activeGeneration == MetronomeBridge.generation.get()) {
            MetronomeBridge.desiredRunning = false
            MetronomeBridge.generation.incrementAndGet()
        }
        if (!MetronomeBridge.desiredRunning) MetronomeBridge.publish(false)
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
    override fun onBind(intent: Intent?) = null
}
