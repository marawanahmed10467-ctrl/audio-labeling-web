import { useState, useEffect } from "react";
import LoginPage from "./components/LoginPage";
import LabelingPanel from "./components/LabelingPage";
import AdminPanel from "./components/AdminPage"; // ← ADD THIS IMPORT

function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    if (storedUser) setUser(JSON.parse(storedUser));
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  };

  return (
    <div>
      {!user ? (
        <LoginPage onLogin={setUser} />
      ) : user.role === 'admin' ? (
        <AdminPanel user={user} onLogout={handleLogout} />
      ) : (
        <LabelingPanel user={user} onLogout={handleLogout} />
      )}
    </div>
  );
}

export default App;
