import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = 8000;

app.use(cors());
app.use(express.json());



app.get('/', (req, res) => {
  res.send({
    message: 'server is running fine!'
  });
});



app.listen(PORT, () => {
  console.log(`BookNook server is running on http://localhost:${PORT}`);
});


export default app;
