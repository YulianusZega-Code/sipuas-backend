/**
 * ======================================
 * SiPUAS Backend - FINAL VERSION
 * ======================================
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();

/**
 * ======================================
 * MIDDLEWARE
 * ======================================
 */
app.use(
  cors({
    origin: "*", // untuk sekarang bebas, nanti bisa dikunci ke sipuas.online
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

/**
 * ======================================
 * STATIC FILE (UPLOAD FOTO)
 * ======================================
 */
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
app.use("/uploads", express.static(uploadsDir));

/**
 * ======================================
 * DATABASE CONNECTION (RENDER & LOCAL)
 * ======================================
 */
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// 🔎 TEST DATABASE CONNECTION SAAT START
(async () => {
  try {
    const conn = await db.getConnection();
    console.log("✅ Database connected");
    conn.release();
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
  }
})();

/**
 * ======================================
 * MULTER CONFIG (UPLOAD FOTO GURU)
 * ======================================
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "teacher-" + unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const allowed = /jpeg|jpg|png|gif/;
    if (
      allowed.test(file.mimetype) &&
      allowed.test(path.extname(file.originalname).toLowerCase())
    ) {
      cb(null, true);
    } else {
      cb(new Error("Hanya file gambar yang diperbolehkan"));
    }
  },
});

/**
 * ======================================
 * HELPER
 * ======================================
 */
function getAspect(no) {
  if (no <= 5) return "Kompetensi Mengajar";
  if (no <= 10) return "Manajemen Kelas";
  if (no <= 15) return "Interaksi dengan Siswa";
  if (no <= 20) return "Penilaian & Feedback";
  if (no <= 25) return "Profesionalisme";
  throw new Error("Nomor soal tidak valid");
}

/**
 * ======================================
 * TEST ROUTE
 * ======================================
 */
app.get("/", (req, res) => {
  res.send("Backend SiPUAS jalan");
});

/**
 * ======================================
 * AUTH - SISWA
 * ======================================
 */
app.post("/api/auth/student", async (req, res) => {
  try {
    const { nis, password } = req.body;

    const [rows] = await db.query(
      "SELECT id, nis, name, class_id FROM students WHERE nis=? AND password=?",
      [nis, password]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: "NIS atau password salah" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Login siswa error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ======================================
 * AUTH - ADMIN
 * ======================================
 */
app.post("/api/auth/admin", async (req, res) => {
  try {
    const { username, password } = req.body;

    const [rows] = await db.query(
      "SELECT id, username, name FROM admin_users WHERE username=? AND password=?",
      [username, password]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: "Login admin gagal" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Login admin error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ======================================
 * GURU (SISWA VIEW)
 * ======================================
 */
app.get("/api/teachers/:classId/:studentId", async (req, res) => {
  try {
    const { classId, studentId } = req.params;

    const sql = `
      SELECT 
        te.id AS teaching_id,
        t.id AS teacher_id,
        t.name,
        t.photo,
        s.name AS subject,
        IF(sv.id IS NULL, 0, 1) AS sudah_dinilai
      FROM teachings te
      JOIN teachers t ON te.teacher_id = t.id
      JOIN subjects s ON te.subject_id = s.id
      LEFT JOIN surveys sv 
        ON sv.teaching_id = te.id AND sv.student_id = ?
      WHERE te.class_id = ?
    `;

    const [rows] = await db.query(sql, [studentId, classId]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal mengambil data guru" });
  }
});

/**
 * ======================================
 * SURVEY
 * ======================================
 */
app.post("/api/surveys", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { student_id, teaching_id, resume, answers } = req.body;

    if (!student_id || !teaching_id || !resume || answers.length !== 25) {
      return res.status(400).json({ message: "Data survey tidak lengkap" });
    }

    await conn.beginTransaction();

    const [result] = await conn.query(
      "INSERT INTO surveys (student_id, teaching_id, resume) VALUES (?, ?, ?)",
      [student_id, teaching_id, resume]
    );

    const surveyId = result.insertId;

    const values = answers.map((a) => [
      surveyId,
      getAspect(a.question_number),
      a.question_number,
      a.value,
    ]);

    await conn.query(
      "INSERT INTO survey_answers (survey_id, aspect, question_number, value) VALUES ?",
      [values]
    );

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: "Gagal menyimpan survey" });
  } finally {
    conn.release();
  }
});

/**
 * ======================================
 * ADMIN - STUDENTS (CRUD)
 * ======================================
 */
app.get("/api/admin/students", async (req, res) => {
  const [rows] = await db.query(`
    SELECT s.id, s.nis, s.name, c.name AS class_name, s.class_id
    FROM students s
    JOIN classes c ON s.class_id = c.id
    ORDER BY c.name, s.name
  `);
  res.json(rows);
});

app.post("/api/admin/students", async (req, res) => {
  const { nis, name, class_id } = req.body;
  await db.query(
    "INSERT INTO students (nis, name, class_id, password) VALUES (?, ?, ?, ?)",
    [nis, name, class_id, nis]
  );
  res.json({ success: true });
});

app.put("/api/admin/students/:id", async (req, res) => {
  const { id } = req.params;
  const { nis, name, class_id } = req.body;
  await db.query(
    "UPDATE students SET nis=?, name=?, class_id=? WHERE id=?",
    [nis, name, class_id, id]
  );
  res.json({ success: true });
});

app.delete("/api/admin/students/:id", async (req, res) => {
  await db.query("DELETE FROM students WHERE id=?", [req.params.id]);
  res.json({ success: true });
});

app.post("/api/admin/students/:id/reset-password", async (req, res) => {
  const [[s]] = await db.query("SELECT nis FROM students WHERE id=?", [
    req.params.id,
  ]);
  await db.query("UPDATE students SET password=? WHERE id=?", [
    s.nis,
    req.params.id,
  ]);
  res.json({ success: true });
});

/**
 * ======================================
 * SERVER START
 * ======================================
 */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log("🚀 Backend SiPUAS running on port", PORT);
});
