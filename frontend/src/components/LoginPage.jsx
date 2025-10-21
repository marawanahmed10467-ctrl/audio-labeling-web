import React, { useState } from 'react';
import api from '../api/axios';


function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      console.log("🔄 Login attempt with:", { email, password: "***" });
      
      const res = await api.post("/auth/login", {
        email,
        password,
      });

      console.log("✅ Response received:", res.data);
      
      if (res.data.success) {
        const { token, user } = res.data;
        localStorage.setItem("token", token);
        localStorage.setItem("user", JSON.stringify(user));
        onLogin(user);
      } else {
        setError(res.data.message || "Login failed");
      }
      
    } catch (err) {
      console.error("💥 FULL ERROR OBJECT:", err);
      console.error("💥 Error response:", err.response);
      console.error("💥 Error message:", err.message);
      console.error("💥 Error code:", err.code);
      
      setError(err.response?.data?.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = (demoEmail, demoPassword) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2>Audio Labeling Tool</h2>
        <p>Sign in to your account</p>
      </div>

      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.inputGroup}>
          <label htmlFor="email" style={styles.label}>Email Address</label>
          <input
            id="email"
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={styles.input}
            disabled={loading}
          />
        </div>

        <div style={styles.inputGroup}>
          <label htmlFor="password" style={styles.label}>Password</label>
          <input
            id="password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={styles.input}
            disabled={loading}
          />
        </div>

        <button 
          type="submit" 
          style={{
            ...styles.button,
            ...(loading ? styles.buttonDisabled : {})
          }}
          disabled={loading}
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>

      {error && (
        <div style={styles.error}>
          ⚠️ {error}
        </div>
      )}

      <div style={styles.demoSection}>
        <h4 style={styles.demoTitle}>Quick Test:</h4>
        <button 
          onClick={() => handleDemoLogin("admin@example.com", "admin123")}
          style={styles.demoButton}
        >
          Use Admin Account
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: 400,
    margin: "50px auto",
    padding: "30px",
    border: "1px solid #e1e5e9",
    borderRadius: "12px",
    boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
    backgroundColor: "white",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  header: {
    textAlign: "center",
    marginBottom: "30px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  label: {
    fontWeight: "600",
    color: "#2d3748",
    fontSize: "14px",
  },
  input: {
    padding: "12px 16px",
    fontSize: "16px",
    border: "2px solid #e2e8f0",
    borderRadius: "8px",
    outline: "none",
    backgroundColor: "#f7fafc",
  },
  button: {
    padding: "14px",
    fontSize: "16px",
    fontWeight: "600",
    backgroundColor: "#4299e1",
    color: "white",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    marginTop: "10px",
  },
  buttonDisabled: {
    backgroundColor: "#a0aec0",
    cursor: "not-allowed",
  },
  error: {
    marginTop: "15px",
    padding: "12px",
    backgroundColor: "#fed7d7",
    color: "#c53030",
    border: "1px solid #feb2b2",
    borderRadius: "8px",
    textAlign: "center",
    fontSize: "14px",
    fontWeight: "500",
  },
  demoSection: {
    marginTop: "30px",
    padding: "20px",
    backgroundColor: "#f7fafc",
    borderRadius: "8px",
    border: "1px solid #e2e8f0",
    textAlign: "center",
  },
  demoTitle: {
    margin: "0 0 15px 0",
    fontSize: "14px",
    color: "#4a5568",
  },
  demoButton: {
    padding: "10px",
    fontSize: "14px",
    backgroundColor: "#edf2f7",
    color: "#4a5568",
    border: "1px solid #cbd5e0",
    borderRadius: "6px",
    cursor: "pointer",
  },
};

export default LoginPage;

