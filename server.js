const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Serve static files untuk foto
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Buat folder uploads jika belum ada
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// ===============================
// KONEKSI DATABASE
// ===============================
const db = mysql.createPool({
  host: "localhost",
  user: "u474310197_sipuas_user",
  password: "#P3lit431",
  database: "u474310197_sipuas_db",
  waitForConnections: true,
  connectionLimit: 10,
});

// ===============================
// MULTER CONFIG untuk Upload
// ===============================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "teacher-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|gif/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("Hanya file gambar yang diperbolehkan!"));
  },
});

// ===============================
// HELPER: TENTUKAN ASPEK (TERKUNCI)
// ===============================
function getAspect(questionNumber) {
  if (questionNumber >= 1 && questionNumber <= 5) return "Kompetensi Mengajar";
  if (questionNumber >= 6 && questionNumber <= 10) return "Manajemen Kelas";
  if (questionNumber >= 11 && questionNumber <= 15)
    return "Interaksi dengan Siswa";
  if (questionNumber >= 16 && questionNumber <= 20)
    return "Penilaian & Feedback";
  if (questionNumber >= 21 && questionNumber <= 25) return "Profesionalisme";

  throw new Error("Nomor soal tidak valid: " + questionNumber);
}

// ===============================
// TEST ROUTE
// ===============================
app.get("/", (req, res) => {
  res.send("Backend SiPUAS jalan");
});

// ===============================
// UPLOAD FOTO GURU
// ===============================
app.post("/api/upload-teacher-photo", upload.single("photo"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Tidak ada file yang diupload" });
    }

    const photoUrl = `/uploads/${req.file.filename}`;
    res.json({
      success: true,
      photoUrl: photoUrl,
      message: "Foto berhasil diupload",
    });
  } catch (err) {
    console.error("Error upload photo:", err);
    res.status(500).json({ message: "Gagal mengupload foto" });
  }
});

// ===============================
// LOGIN SISWA
// ===============================
app.post("/api/auth/student", async (req, res) => {
  try {
    const { nis, password } = req.body;

    const [rows] = await db.query(
      "SELECT id, name, class_id FROM students WHERE nis=? AND password=?",
      [nis, password]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: "Login gagal" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error login siswa:", err);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

// ===============================
// LOGIN ADMIN
// ===============================
app.post("/api/auth/admin", async (req, res) => {
  try {
    const { username, password } = req.body;

    const [rows] = await db.query(
      "SELECT id, username, name FROM admin_users WHERE username=? AND password=?",
      [username, password]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: "Username atau password salah" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error login admin:", err);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

// ===============================
// AMBIL GURU + STATUS PENILAIAN
// ===============================
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
        ON sv.teaching_id = te.id
        AND sv.student_id = ?
      WHERE te.class_id = ?
    `;

    const [rows] = await db.query(sql, [studentId, classId]);
    res.json(rows);
  } catch (err) {
    console.error("Error get teachers:", err);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

// ===============================
// SIMPAN SURVEY BARU (TERKUNCI)
// ===============================
app.post("/api/surveys", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { student_id, teaching_id, resume, answers } = req.body;

    if (
      !student_id ||
      !teaching_id ||
      !resume ||
      !Array.isArray(answers) ||
      answers.length !== 25
    ) {
      return res.status(400).json({ message: "Data survey tidak lengkap" });
    }

    await connection.beginTransaction();

    const [result] = await connection.query(
      "INSERT INTO surveys (student_id, teaching_id, resume) VALUES (?, ?, ?)",
      [student_id, teaching_id, resume]
    );

    const surveyId = result.insertId;

    const answerValues = answers.map((a) => [
      surveyId,
      getAspect(a.question_number),
      a.question_number,
      a.value,
    ]);

    await connection.query(
      `INSERT INTO survey_answers (survey_id, aspect, question_number, value) VALUES ?`,
      [answerValues]
    );

    await connection.commit();
    res.json({ success: true, survey_id: surveyId });
  } catch (err) {
    await connection.rollback();
    console.error("Error submit survey:", err);
    res.status(500).json({ message: "Gagal menyimpan survey" });
  } finally {
    connection.release();
  }
});

// ===============================
// CEK SURVEY (UNTUK EDIT)
// ===============================
app.get("/api/surveys/:studentId/:teachingId", async (req, res) => {
  try {
    const { studentId, teachingId } = req.params;

    const [surveys] = await db.query(
      "SELECT id, resume FROM surveys WHERE student_id = ? AND teaching_id = ?",
      [studentId, teachingId]
    );

    if (surveys.length === 0) {
      return res.json(null);
    }

    const surveyId = surveys[0].id;

    const [answers] = await db.query(
      `SELECT aspect, question_number, value 
       FROM survey_answers 
       WHERE survey_id = ? 
       ORDER BY question_number`,
      [surveyId]
    );

    res.json({
      survey_id: surveyId,
      resume: surveys[0].resume,
      answers,
    });
  } catch (err) {
    console.error("Error fetch survey:", err);
    res.status(500).json({ message: "Gagal memuat survey" });
  }
});

// ===============================
// UPDATE SURVEY (EDIT) – TERKUNCI
// ===============================
app.put("/api/surveys/:surveyId", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { surveyId } = req.params;
    const { resume, answers } = req.body;

    if (!resume || !Array.isArray(answers) || answers.length !== 25) {
      return res.status(400).json({ message: "Data update tidak valid" });
    }

    await connection.beginTransaction();

    await connection.query("UPDATE surveys SET resume=? WHERE id=?", [
      resume,
      surveyId,
    ]);

    await connection.query("DELETE FROM survey_answers WHERE survey_id=?", [
      surveyId,
    ]);

    const values = answers.map((a) => [
      surveyId,
      getAspect(a.question_number),
      a.question_number,
      a.value,
    ]);

    await connection.query(
      `INSERT INTO survey_answers (survey_id, aspect, question_number, value) VALUES ?`,
      [values]
    );

    await connection.commit();
    res.json({ success: true });
  } catch (err) {
    await connection.rollback();
    console.error("Error update survey:", err);
    res.status(500).json({ message: "Gagal memperbarui survey" });
  } finally {
    connection.release();
  }
});

// ===============================
// DASHBOARD ADMIN – FINAL & BERSIH
// ===============================
app.get("/api/admin/teachers", async (req, res) => {
  try {
    const sql = `
      SELECT
        t.name AS teacher_name,
        t.photo AS teacher_photo,
        s.name AS subject,
        sa.aspect,
        ROUND(AVG(sa.value), 2) AS avg_score,
        COUNT(DISTINCT sv.id) AS total_responden
      FROM surveys sv
      JOIN survey_answers sa ON sa.survey_id = sv.id
      JOIN teachings te ON sv.teaching_id = te.id
      JOIN teachers t ON te.teacher_id = t.id
      JOIN subjects s ON te.subject_id = s.id
      GROUP BY teacher_name, teacher_photo, subject, sa.aspect
      ORDER BY teacher_name, sa.aspect
    `;

    const [rows] = await db.query(sql);
    res.json(rows);
  } catch (err) {
    console.error("Error get admin teachers:", err);
    res.status(500).json({ message: "Gagal ambil rekap guru" });
  }
});

// ===============================
// DASHBOARD ADMIN – RESUME
// ===============================
app.get("/api/admin/resumes", async (req, res) => {
  try {
    const sql = `
      SELECT
        t.name AS teacher_name,
        t.photo AS teacher_photo,
        s.name AS subject,
        st.name AS student_name,
        sv.resume,
        sv.created_at
      FROM surveys sv
      JOIN teachings te ON sv.teaching_id = te.id
      JOIN teachers t ON te.teacher_id = t.id
      JOIN subjects s ON te.subject_id = s.id
      JOIN students st ON sv.student_id = st.id
      WHERE sv.resume IS NOT NULL
      ORDER BY sv.created_at DESC
    `;

    const [rows] = await db.query(sql);
    res.json(rows);
  } catch (err) {
    console.error("Error get resumes:", err);
    res.status(500).json({ message: "Gagal ambil resume" });
  }
});

// ===============================
// ADMIN - CRUD KELAS
// ===============================
app.get("/api/admin/classes", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM classes ORDER BY id ASC");
    res.json(rows);
  } catch (err) {
    console.error("Error get classes:", err);
    res.status(500).json({ message: "Gagal ambil kelas" });
  }
});

app.post("/api/admin/classes", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ message: "Nama kelas wajib diisi" });
    }

    const [result] = await db.query("INSERT INTO classes (name) VALUES (?)", [
      name,
    ]);
    res.json({ id: result.insertId, name });
  } catch (err) {
    console.error("Error create class:", err);
    res.status(500).json({ message: "Gagal menambah kelas" });
  }
});

app.put("/api/admin/classes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    await db.query("UPDATE classes SET name=? WHERE id=?", [name, id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Error update class:", err);
    res.status(500).json({ message: "Gagal update kelas" });
  }
});

app.delete("/api/admin/classes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.query("DELETE FROM classes WHERE id=?", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Error delete class:", err);
    res.status(500).json({ message: "Gagal hapus kelas" });
  }
});

// ===============================
// ADMIN - CRUD MATA PELAJARAN
// ===============================
app.get("/api/admin/subjects", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM subjects ORDER BY id ASC");
    res.json(rows);
  } catch (err) {
    console.error("Error get subjects:", err);
    res.status(500).json({ message: "Gagal ambil mata pelajaran" });
  }
});

app.post("/api/admin/subjects", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res
        .status(400)
        .json({ message: "Nama mata pelajaran wajib diisi" });
    }

    const [result] = await db.query("INSERT INTO subjects (name) VALUES (?)", [
      name,
    ]);
    res.json({ id: result.insertId, name });
  } catch (err) {
    console.error("Error create subject:", err);
    res.status(500).json({ message: "Gagal menambah mata pelajaran" });
  }
});

app.put("/api/admin/subjects/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    await db.query("UPDATE subjects SET name=? WHERE id=?", [name, id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Error update subject:", err);
    res.status(500).json({ message: "Gagal update mata pelajaran" });
  }
});

app.delete("/api/admin/subjects/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.query("DELETE FROM subjects WHERE id=?", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Error delete subject:", err);
    res.status(500).json({ message: "Gagal hapus mata pelajaran" });
  }
});

// ===============================
// ADMIN - CRUD GURU
// ===============================
app.get("/api/admin/teachers-crud", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM teachers ORDER BY id ASC");
    res.json(rows);
  } catch (err) {
    console.error("Error get teachers:", err);
    res.status(500).json({
      message: err.message,
      code: err.code,
    });
  }
});

app.post("/api/admin/teachers-crud", async (req, res) => {
  try {
    const { nip, name, photo } = req.body;

    if (!nip || !name) {
      return res.status(400).json({
        message: "NIP dan Nama wajib diisi",
      });
    }

    await db.query("INSERT INTO teachers (nip, name, photo) VALUES (?, ?, ?)", [
      nip,
      name,
      photo || "👨‍🏫",
    ]);

    res.json({
      success: true,
      message: "Guru berhasil ditambahkan",
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "NIP sudah terdaftar",
      });
    }

    console.error("Error create teacher:", err);
    res.status(500).json({
      message: "Terjadi kesalahan server",
    });
  }
});

app.put("/api/admin/teachers-crud/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nip, name, photo } = req.body;

    if (!nip || !name) {
      return res.status(400).json({
        message: "NIP dan Nama wajib diisi",
      });
    }

    await db.query("UPDATE teachers SET nip=?, name=?, photo=? WHERE id=?", [
      nip,
      name,
      photo,
      id,
    ]);

    res.json({
      success: true,
      message: "Data guru berhasil diperbarui",
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "NIP sudah digunakan guru lain",
      });
    }

    console.error("Error update teacher:", err);
    res.status(500).json({
      message: "Gagal memperbarui data guru",
    });
  }
});

app.delete("/api/admin/teachers-crud/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.query("DELETE FROM teachers WHERE id=?", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Error delete teacher:", err);
    res.status(500).json({ message: "Gagal hapus guru" });
  }
});

// ===============================
// ADMIN - CRUD TEACHING
// ===============================
app.get("/api/admin/teachings", async (req, res) => {
  try {
    const sql = `
      SELECT 
        te.id,
        te.teacher_id,
        te.subject_id,
        te.class_id,
        t.name AS teacher_name,
        t.nip,
        s.name AS subject_name,
        c.name AS class_name
      FROM teachings te
      JOIN teachers t ON te.teacher_id = t.id
      JOIN subjects s ON te.subject_id = s.id
      JOIN classes c ON te.class_id = c.id
      ORDER BY c.name, s.name
    `;
    const [rows] = await db.query(sql);
    res.json(rows);
  } catch (err) {
    console.error("Error get teachings:", err);
    res.status(500).json({ message: "Gagal ambil data pengajaran" });
  }
});

app.post("/api/admin/teachings", async (req, res) => {
  try {
    const { teacher_id, subject_id, class_id } = req.body;

    if (!teacher_id || !subject_id || !class_id) {
      return res.status(400).json({
        message: "Guru, Mata Pelajaran, dan Kelas wajib diisi",
      });
    }

    await db.query(
      "INSERT INTO teachings (teacher_id, subject_id, class_id) VALUES (?, ?, ?)",
      [teacher_id, subject_id, class_id]
    );

    res.json({
      success: true,
      message: "Pengajaran berhasil ditambahkan",
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Pengajaran ini sudah terdaftar",
      });
    }

    console.error("Error create teaching:", err);
    res.status(500).json({
      message: "Terjadi kesalahan server",
    });
  }
});

app.put("/api/admin/teachings/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { teacher_id, subject_id, class_id } = req.body;

    if (!teacher_id || !subject_id || !class_id) {
      return res.status(400).json({
        message: "Guru, Mata Pelajaran, dan Kelas wajib diisi",
      });
    }

    await db.query(
      "UPDATE teachings SET teacher_id=?, subject_id=?, class_id=? WHERE id=?",
      [teacher_id, subject_id, class_id, id]
    );

    res.json({
      success: true,
      message: "Data pengajaran berhasil diperbarui",
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Pengajaran ini sudah ada",
      });
    }

    console.error("Error update teaching:", err);
    res.status(500).json({
      message: "Gagal memperbarui data pengajaran",
    });
  }
});

app.delete("/api/admin/teachings/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.query("DELETE FROM teachings WHERE id=?", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Error delete teaching:", err);
    res.status(500).json({ message: "Gagal hapus pengajaran" });
  }
});

app.get("/api/admin/teaching-options", async (req, res) => {
  try {
    const [teachers] = await db.query(
      "SELECT id, name, nip FROM teachers ORDER BY name"
    );
    const [subjects] = await db.query(
      "SELECT id, name FROM subjects ORDER BY name"
    );
    const [classes] = await db.query(
      "SELECT id, name FROM classes ORDER BY name"
    );

    res.json({ teachers, subjects, classes });
  } catch (err) {
    console.error("Error get teaching options:", err);
    res.status(500).json({ message: "Gagal ambil data" });
  }
});

app.get("/api/admin/students", async (req, res) => {
  try {
    const sql = `
      SELECT st.id, st.nis, st.name, st.class_id, c.name AS class_name
      FROM students st
      JOIN classes c ON st.class_id = c.id
      ORDER BY c.name, st.name
    `;
    const [rows] = await db.query(sql);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal mengambil data siswa" });
  }
});

app.post("/api/admin/students", async (req, res) => {
  try {
    const { nis, name, class_id } = req.body;

    if (!nis || !name || !class_id) {
      return res.status(400).json({ message: "Data siswa tidak lengkap" });
    }

    await db.query(
      "INSERT INTO students (nis, name, class_id, password) VALUES (?, ?, ?, ?)",
      [nis, name, class_id, nis]
    );

    res.json({ success: true, message: "Siswa berhasil ditambahkan" });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "NIS sudah terdaftar" });
    }
    console.error(err);
    res.status(500).json({ message: "Gagal menambah siswa" });
  }
});

app.put("/api/admin/students/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nis, name, class_id } = req.body;

    if (!nis || !name || !class_id) {
      return res.status(400).json({ message: "Data siswa tidak lengkap" });
    }

    await db.query("UPDATE students SET nis=?, name=?, class_id=? WHERE id=?", [
      nis,
      name,
      class_id,
      id,
    ]);

    res.json({ success: true, message: "Data siswa berhasil diperbarui" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal memperbarui siswa" });
  }
});

app.delete("/api/admin/students/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.query("DELETE FROM students WHERE id=?", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal menghapus siswa" });
  }
});

app.post("/api/admin/students/:id/reset-password", async (req, res) => {
  try {
    const { id } = req.params;

    const [[student]] = await db.query("SELECT nis FROM students WHERE id=?", [
      id,
    ]);

    await db.query("UPDATE students SET password=? WHERE id=?", [
      student.nis,
      id,
    ]);

    res.json({ success: true, message: "Password direset ke NIS" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal reset password" });
  }
});

// ===============================
// JALANKAN SERVER
// ===============================
app.listen(3001, () => {
  console.log("🚀 Backend jalan di http://localhost:3001");
});
