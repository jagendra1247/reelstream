require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Middleware ───────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json());

// ─── Static folder for uploaded files ────────────────────────
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOADS_DIR));

// ─── MongoDB Connection ───────────────────────────────────────
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://reelstream:reelstream2024@cluster0.mongodb.net/reelstream?retryWrites=true&w=majority";

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    console.log("⚠️  Running with in-memory data (demo mode)");
  });

// ─── Video Schema ─────────────────────────────────────────────
const videoSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    videoUrl: { type: String, required: true, trim: true },
    thumbnailUrl: { type: String, default: "", trim: true },
    category: {
      type: String,
      enum: ["trending", "latest", "popular"],
      default: "latest",
    },
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const Video = mongoose.model("Video", videoSchema);

// ─── In-Memory Fallback ───────────────────────────────────────
let memVideos = [];
const isConnected = () => mongoose.connection.readyState === 1;

// ─── Multer Setup ─────────────────────────────────────────────

// Check if Cloudinary is configured
const USE_CLOUDINARY =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

let cloudinary, CloudinaryStorage;

if (USE_CLOUDINARY) {
  try {
    cloudinary = require("cloudinary").v2;
    const { CloudinaryStorage: CS } = require("multer-storage-cloudinary");
    CloudinaryStorage = CS;

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    console.log("☁️  Cloudinary configured");
  } catch (e) {
    console.log("⚠️  Cloudinary packages not installed, using local storage");
  }
}

// ── Video Storage ──
let videoStorage;
if (USE_CLOUDINARY && cloudinary && CloudinaryStorage) {
  videoStorage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder: "reelstream/videos",
      resource_type: "video",
      allowed_formats: ["mp4", "mov", "webm", "avi"],
    },
  });
} else {
  // Local disk storage
  videoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS_DIR, "videos");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
      cb(null, unique + path.extname(file.originalname));
    },
  });
}

// ── Thumbnail Storage ──
let thumbStorage;
if (USE_CLOUDINARY && cloudinary && CloudinaryStorage) {
  thumbStorage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder: "reelstream/thumbnails",
      resource_type: "image",
      allowed_formats: ["jpg", "jpeg", "png", "webp"],
    },
  });
} else {
  thumbStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS_DIR, "thumbnails");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
      cb(null, unique + path.extname(file.originalname));
    },
  });
}

// File type filter
const videoFilter = (req, file, cb) => {
  const allowed = /mp4|mov|webm|avi|mkv/i;
  if (allowed.test(path.extname(file.originalname)) || file.mimetype.startsWith("video/")) {
    cb(null, true);
  } else {
    cb(new Error("Sirf video files allowed hain (mp4, mov, webm)"), false);
  }
};

const imageFilter = (req, file, cb) => {
  const allowed = /jpg|jpeg|png|webp|gif/i;
  if (allowed.test(path.extname(file.originalname)) || file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Sirf image files allowed hain (jpg, png, webp)"), false);
  }
};

const uploadVideo = multer({
  storage: videoStorage,
  fileFilter: videoFilter,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
});

const uploadThumb = multer({
  storage: thumbStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

// ─── Helper: get public URL ───────────────────────────────────
function getPublicUrl(req, file) {
  // Cloudinary returns secure_url directly on file object
  if (file.path && file.path.startsWith("http")) return file.path;
  // Local file — build URL from request
  const host = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
  return `${host}/uploads/${path.relative(UPLOADS_DIR, file.path).replace(/\\/g, "/")}`;
}

// ─── Routes ───────────────────────────────────────────────────

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "ReelStream API is running 🚀",
    storage: USE_CLOUDINARY && cloudinary ? "cloudinary" : "local",
    db: isConnected() ? "mongodb" : "memory",
  });
});

// ── POST /upload/video ────────────────────────────────────────
app.post("/upload/video", (req, res) => {
  uploadVideo.single("video")(req, res, (err) => {
    if (err) {
      console.error("Video upload error:", err.message);
      return res.status(400).json({ success: false, message: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Koi video file nahi mili" });
    }
    const url = getPublicUrl(req, req.file);
    console.log("✅ Video uploaded:", url);
    return res.json({ success: true, url });
  });
});

// ── POST /upload/thumbnail ────────────────────────────────────
app.post("/upload/thumbnail", (req, res) => {
  uploadThumb.single("thumbnail")(req, res, (err) => {
    if (err) {
      console.error("Thumbnail upload error:", err.message);
      return res.status(400).json({ success: false, message: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Koi image file nahi mili" });
    }
    const url = getPublicUrl(req, req.file);
    console.log("✅ Thumbnail uploaded:", url);
    return res.json({ success: true, url });
  });
});

// ── GET /videos ───────────────────────────────────────────────
app.get("/videos", async (req, res) => {
  try {
    const { category, search } = req.query;
    if (isConnected()) {
      let query = {};
      if (category && category !== "all") query.category = category;
      if (search) query.title = { $regex: search, $options: "i" };
      const videos = await Video.find(query).sort({ createdAt: -1 });
      return res.json({ success: true, data: videos });
    } else {
      let data = [...memVideos].reverse();
      if (category && category !== "all") data = data.filter((v) => v.category === category);
      if (search) data = data.filter((v) => v.title.toLowerCase().includes(search.toLowerCase()));
      return res.json({ success: true, data });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /videos/:id ───────────────────────────────────────────
app.get("/videos/:id", async (req, res) => {
  try {
    if (isConnected()) {
      const video = await Video.findByIdAndUpdate(
        req.params.id,
        { $inc: { views: 1 } },
        { new: true }
      );
      if (!video) return res.status(404).json({ success: false, message: "Video not found" });
      return res.json({ success: true, data: video });
    } else {
      const video = memVideos.find((v) => v._id === req.params.id);
      if (!video) return res.status(404).json({ success: false, message: "Video not found" });
      video.views += 1;
      return res.json({ success: true, data: video });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /videos ──────────────────────────────────────────────
app.post("/videos", async (req, res) => {
  try {
    const { title, videoUrl, thumbnailUrl, category } = req.body;
    if (!title || !videoUrl) {
      return res.status(400).json({ success: false, message: "title aur videoUrl required hain" });
    }
    if (isConnected()) {
      const video = new Video({ title, videoUrl, thumbnailUrl, category });
      await video.save();
      return res.status(201).json({ success: true, data: video });
    } else {
      const video = {
        _id: "mem_" + Date.now(),
        title, videoUrl,
        thumbnailUrl: thumbnailUrl || "",
        category: category || "latest",
        views: 0, likes: 0,
        createdAt: new Date().toISOString(),
      };
      memVideos.push(video);
      return res.status(201).json({ success: true, data: video });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /videos/:id ───────────────────────────────────────────
app.put("/videos/:id", async (req, res) => {
  try {
    const { title, videoUrl, thumbnailUrl, category } = req.body;
    if (isConnected()) {
      const video = await Video.findByIdAndUpdate(
        req.params.id,
        { title, videoUrl, thumbnailUrl, category },
        { new: true, runValidators: true }
      );
      if (!video) return res.status(404).json({ success: false, message: "Video not found" });
      return res.json({ success: true, data: video });
    } else {
      const idx = memVideos.findIndex((v) => v._id === req.params.id);
      if (idx === -1) return res.status(404).json({ success: false, message: "Video not found" });
      memVideos[idx] = { ...memVideos[idx], title, videoUrl, thumbnailUrl, category };
      return res.json({ success: true, data: memVideos[idx] });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /videos/:id ────────────────────────────────────────
app.delete("/videos/:id", async (req, res) => {
  try {
    if (isConnected()) {
      const video = await Video.findByIdAndDelete(req.params.id);
      if (!video) return res.status(404).json({ success: false, message: "Video not found" });
      return res.json({ success: true, message: "Video deleted" });
    } else {
      const idx = memVideos.findIndex((v) => v._id === req.params.id);
      if (idx === -1) return res.status(404).json({ success: false, message: "Video not found" });
      memVideos.splice(idx, 1);
      return res.json({ success: true, message: "Video deleted" });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /admin/login ─────────────────────────────────────────
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;
  const ADMIN_USER = process.env.ADMIN_USERNAME || "admin";
  const ADMIN_PASS = process.env.ADMIN_PASSWORD || "1234";
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ success: true, token: "reelstream_admin_token_2024" });
  }
  res.status(401).json({ success: false, message: "Invalid credentials" });
});

// ─── Start Server ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 ReelStream API running on http://localhost:${PORT}`);
  console.log(`📁 Storage: ${USE_CLOUDINARY && cloudinary ? "Cloudinary" : "Local (./uploads)"}`);
  console.log(`🗄️  Database: ${isConnected() ? "MongoDB" : "In-Memory"}`);
});
