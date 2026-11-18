import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const app = express();
const PORT = 8000;

app.use(cors());
app.use(express.json());

if (!process.env.MONGO_DB_URL) {
  throw new Error('MONGO_DB_URL is missing. Add it to your .env file.');
}

if (!process.env.CLIENT_URL) {
  throw new Error('CLIENT_URL is missing. Add it to your .env file.');
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


const JWKS = createRemoteJWKSet(
  new URL('/api/auth/jwks', process.env.CLIENT_URL)
);

export const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send({ msg: 'unauthorized' });
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).send({ msg: 'unauthorized' });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);

    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).send({ msg: 'Invalid token' });
  }
};

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
