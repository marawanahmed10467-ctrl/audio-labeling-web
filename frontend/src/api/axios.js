import axios from 'axios';

const baseURL = process.env.REACT_APP_API_URL || "http://localhost:5000/api";

const api = axios.create({
  baseURL: baseURL,
});

console.log('API Base URL:', baseURL); 

export default api;