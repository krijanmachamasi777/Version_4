// src/controllers/notificationController.js
//
// NEW FILE — Handles notification email sending.
// Uses nodemailer with Gmail SMTP (via env vars).
// Does NOT affect any existing controller, route, or model.
//
const nodemailer = require("nodemailer");
const User       = require("../models/User");
const logger     = require("../utils/logger");

const ok  = (res, data, meta = {}) => res.json({ success: true, ...meta, data });
const err = (res, message, status = 400) =>
  res.status(status).json({ success: false, message });

// POST /api/notifications/send-email
// Body: { subject, message }
// Sends to the currently logged-in user's email (from User model)
exports.sendNotificationEmail = async (req, res) => {
  try {
    // Get user email from DB (req.user.id set by auth middleware)
    const user = await User.findById(req.user.id).select("email name username").lean();
    if (!user) return err(res, "User not found.", 404);

    const recipientEmail = user.email;
    if (!recipientEmail) {
      return err(res, "No email address on file for this user.", 400);
    }

    const { subject, message } = req.body;
    if (!subject || !message) {
      return err(res, "subject and message are required.", 400);
    }

    // Build transporter from env vars (Gmail App Password)
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.NOTIFY_EMAIL_USER,
        pass: process.env.NOTIFY_EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Kitakat Notifications" <${process.env.NOTIFY_EMAIL_USER}>`,
      to:   recipientEmail,
      subject,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0d0d0f;color:#f0f0f5;padding:24px;border-radius:12px;">
          <h2 style="color:#0a84ff;margin:0 0 12px">📊 Kitakat IPO Alert</h2>
          <p style="color:#888;margin:0 0 16px;font-size:13px;">
            Hi <strong style="color:#f0f0f5">${user.name || user.username}</strong>,
          </p>
          <div style="background:#141416;border:1px solid #2a2a2e;border-radius:8px;padding:16px;white-space:pre-line;font-size:14px;line-height:1.6">
            ${message.replace(/\n/g, "<br>")}
          </div>
          <p style="color:#555;font-size:11px;margin:16px 0 0">
            This is an automated alert from Kitakat Investment Journal.
          </p>
        </div>`,
    });

    logger.info(`📧 Notification email sent to ${recipientEmail}`);
    ok(res, { sentTo: recipientEmail });

  } catch (e) {
    logger.error("sendNotificationEmail error:", e);
    err(res, e.message, 500);
  }
};