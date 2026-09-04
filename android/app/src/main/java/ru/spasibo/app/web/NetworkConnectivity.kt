package ru.spasibo.app.web

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Handler
import android.os.Looper

/** Проверка доступности сети для WebView. */
object NetworkConnectivity {
    private const val OFFLINE_DEBOUNCE_MS = 1_500L

    fun isNetworkAvailable(context: Context): Boolean {
        val connectivityManager =
            context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = connectivityManager.activeNetwork ?: return false
            val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
            return hasWorkingInternet(capabilities)
        }

        @Suppress("DEPRECATION")
        return connectivityManager.activeNetworkInfo?.isConnected == true
    }

    fun registerCallback(
        context: Context,
        onOnline: () -> Unit,
        onOffline: () -> Unit,
    ): () -> Unit {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return {}
        }

        val appContext = context.applicationContext
        val handler = Handler(Looper.getMainLooper())
        var offlineCheck: Runnable? = null

        fun cancelOfflineCheck() {
            offlineCheck?.let { handler.removeCallbacks(it) }
            offlineCheck = null
        }

        fun scheduleOfflineCheck() {
            cancelOfflineCheck()
            offlineCheck = Runnable {
                if (!isNetworkAvailable(appContext)) {
                    onOffline()
                }
            }
            handler.postDelayed(offlineCheck!!, OFFLINE_DEBOUNCE_MS)
        }

        val connectivityManager =
            appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                cancelOfflineCheck()
                if (isNetworkAvailable(appContext)) {
                    onOnline()
                }
            }

            override fun onLost(network: Network) {
                scheduleOfflineCheck()
            }

            override fun onCapabilitiesChanged(
                network: Network,
                networkCapabilities: NetworkCapabilities,
            ) {
                if (hasWorkingInternet(networkCapabilities)) {
                    cancelOfflineCheck()
                    onOnline()
                } else {
                    scheduleOfflineCheck()
                }
            }
        }
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        connectivityManager.registerNetworkCallback(request, callback)
        return {
            cancelOfflineCheck()
            connectivityManager.unregisterNetworkCallback(callback)
        }
    }

    private fun hasWorkingInternet(capabilities: NetworkCapabilities): Boolean {
        if (!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
            return false
        }
        if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
            return true
        }
        return capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    }
}
