/**
 * User model.
 *
 * Stores credentials and the CURRENT refresh token so we can revoke
 * sessions server-side (logout, password change, forced sign-out).
 * Passwords are hashed with bcrypt before save via a pre-save hook.
 */

import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import {
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "../config/constants.js";

const { Schema } = mongoose;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 12;

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: [true, "Email is required."],
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: (value) => EMAIL_REGEX.test(value),
        message: "Invalid email address.",
      },
      index: true,
    },
    username: {
      type: String,
      required: [true, "Username is required."],
      unique: true,
      trim: true,
      minlength: USERNAME_MIN_LENGTH,
      maxlength: USERNAME_MAX_LENGTH,
      index: true,
    },
    password: {
      type: String,
      required: [true, "Password is required."],
      minlength: PASSWORD_MIN_LENGTH,
      // Explicitly excluded from default query results.
      select: false,
    },
    // Stores the most recently issued refresh JWT so we can:
    //   1) detect token reuse / replay,
    //   2) invalidate a session on logout by clearing this field.
    refreshToken: {
      type: String,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.password;
        delete ret.refreshToken;
        delete ret.__v;
        return ret;
      },
    },
  }
);

userSchema.pre("save", async function hashPasswordIfModified(next) {
  if (!this.isModified("password")) return next();
  try {
    this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);
    return next();
  } catch (error) {
    return next(error);
  }
});

/**
 * Compare a plaintext password with the stored hash.
 * Requires the caller to have selected `password` explicitly.
 */
userSchema.methods.isPasswordValid = async function isPasswordValid(plain) {
  if (!this.password) return false;
  return bcrypt.compare(plain, this.password);
};

export const User = mongoose.model("User", userSchema);
