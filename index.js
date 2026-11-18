import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

const app = express();
const PORT = 8000;

app.use(cors());
app.use(express.json());

if (!process.env.MONGO_DB_URL) {
  throw new Error('MONGO_DB_URL is missing. Add it to your .env file.');
}

const client = new MongoClient(process.env.MONGO_DB_URL);

export async function connectToMongoDB() {
  await client.connect();
  console.log('Successfully connected to MongoDB!');
  return client;
}

const database = client.db('booknook');
export const booksCollection = database.collection('books');
export const borrowsCollection = database.collection('borrows');

app.get('/', (req, res) => {
  res.send({
    message: 'server is running fine!'
  });
});

app.listen(PORT, async () => {
  console.log(`BookNook server is running on http://localhost:${PORT}`);

  try {
    await connectToMongoDB();
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
  }
});
export default app;
