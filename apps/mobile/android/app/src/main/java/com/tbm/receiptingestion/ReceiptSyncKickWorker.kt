package com.tbm.receiptingestion

import android.content.Context
import android.content.Intent
import androidx.work.Worker
import androidx.work.WorkerParameters

class ReceiptSyncKickWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
  override fun doWork(): Result {
    val intent = Intent(applicationContext, ReceiptSyncHeadlessService::class.java)
    applicationContext.startService(intent)
    return Result.success()
  }
}
