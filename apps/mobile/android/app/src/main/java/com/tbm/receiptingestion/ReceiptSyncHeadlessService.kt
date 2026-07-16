package com.tbm.receiptingestion

import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class ReceiptSyncHeadlessService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig = HeadlessJsTaskConfig(
    "ChallanSeBootSync",
    Arguments.createMap(),
    30_000,
    false,
  )
}
