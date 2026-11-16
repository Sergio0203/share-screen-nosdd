import { Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { Room } from "./pages/Room";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/sala/:id" element={<Room />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
