import nodemailer from "nodemailer";

function getSmtpPort(): number {
  const value = Number(process.env.SMTP_PORT || "587");
  return Number.isFinite(value) ? value : 587;
}

function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.EMAIL_FROM
  );
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: getSmtpPort(),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendPasswordResetEmail({
  email,
  resetUrl,
  expiresAt,
}: {
  email: string;
  resetUrl: string;
  expiresAt: Date;
}): Promise<{ delivered: boolean; fallbackUrl?: string }> {
  if (!isSmtpConfigured()) {
    console.warn(
      "SMTP is not configured. Falling back to returning password reset URL in development."
    );

    return {
      delivered: false,
      fallbackUrl: resetUrl,
    };
  }

  const transporter = getTransporter();

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Reset your password",
    text: [
      "A password reset was requested for your account.",
      "",
      `Reset your password: ${resetUrl}`,
      "",
      `This link expires at ${expiresAt.toISOString()}.`,
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: `
      <p>A password reset was requested for your account.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>This link expires at ${expiresAt.toISOString()}.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
  });

  return { delivered: true };
}
