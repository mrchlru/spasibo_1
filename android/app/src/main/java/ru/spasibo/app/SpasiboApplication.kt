package ru.spasibo.app

import android.app.Application
import com.google.firebase.FirebaseApp

class SpasiboApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (FirebaseApp.getApps(this).isEmpty()) {
            FirebaseApp.initializeApp(this)
        }
    }
}
