package com.tbm.receiptingestion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager

class ReceiptSyncBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    val constraints = Constraints.Builder()
      .setRequiresCharging(true)
      .setRequiredNetworkType(NetworkType.UNMETERED)
      .build()
    val request = OneTimeWorkRequestBuilder<ReceiptSyncKickWorker>()
      .setConstraints(constraints)
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork("challanse-receipt-sync-kick", ExistingWorkPolicy.REPLACE, request)
  }
}
