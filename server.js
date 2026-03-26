require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Middleware ───────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json());

// ─── MongoDB Connection ───────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://reelstream:reelstream2024@cluster0.mongodb.net/reelstream?retryWrites=true&w=majority";

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

// ─── In-Memory Fallback (if MongoDB not connected) ─────────────
let memVideos = [
  {
    _id: "demo1",
    title: "Sample Reel 1",
    videoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
    thumbnailUrl: "https://picsum.photos/seed/reel1/400/700",
    category: "trending",
    views: 1204,
    likes: 342,
    createdAt: new Date().toISOString(),
  },
  {
    _id: "demo2",
    title: "Sample Reel 2",
    videoUrl: "https://www.w3schools.com/html/movie.mp4",
    thumbnailUrl: "https://picsum.photos/seed/reel2/400/700",
    category: "popular",
    views: 876,
    likes: 210,
    createdAt: new Date().toISOString(),
  },
];

const isConnected = () => mongoose.connection.readyState === 1;

// ─── Routes ───────────────────────────────────────────────────

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "ReelStream API is running 🚀" });
});

// GET /videos — fetch all videos
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

// GET /videos/:id — single video + increment views
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

// POST /videos — create video (admin)
app.post("/videos", async (req, res) => {
  try {
    const { title, videoUrl, thumbnailUrl, category } = req.body;
    if (!title || !videoUrl) {
      return res.status(400).json({ success: false, message: "title and videoUrl are required" });
    }
    if (isConnected()) {
      const video = new Video({ title, videoUrl, thumbnailUrl, category });
      await video.save();
      return res.status(201).json({ success: true, data: video });
    } else {
      const video = {
        _id: "mem_" + Date.now(),
        title,
        videoUrl,
        thumbnailUrl: thumbnailUrl || "https://picsum.photos/seed/" + Date.now() + "/400/700",
        category: category || "latest",
        views: 0,
        likes: 0,
        createdAt: new Date().toISOString(),
      };
      memVideos.push(video);
      return res.status(201).json({ success: true, data: video });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /videos/:id — update video (admin)
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

// DELETE /videos/:id — delete video (admin)
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

// Admin login
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
});
