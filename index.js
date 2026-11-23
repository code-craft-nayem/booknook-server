import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
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

  await borrowsCollection.createIndex({ bookId: 1, userEmail: 1 }, { unique: true });

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

  const [scheme, token] = authHeader.trim().split(/\s+/);

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return res.status(401).send({ msg: 'unauthorized' });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    console.log('JWT Payload:', payload);
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

app.get('/books', async (req, res) => {
  try {
    const books = await booksCollection.find({}).toArray();
    res.send(books);
  } catch (error) {
    console.error('Failed to fetch books:', error.message);
    res.status(500).send({ msg: 'Failed to fetch books' });
  }
});

app.get('/books/:id', async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ msg: 'Invalid book ID' });
  }

  try {
    const book = await booksCollection.findOne({ _id: new ObjectId(id) });

    if (!book) {
      return res.status(404).send({ msg: 'Book not found' });
    }

    res.send(book);
  } catch (error) {
    console.error('Failed to fetch book:', error.message);
    res.status(500).send({ msg: 'Failed to fetch book' });
  }
});


const BOOK_CATEGORIES = ['Fiction', 'Science', 'History', 'Kids', 'Others'];
app.post('/books', verifyToken, async (req, res) => {
  const { title, author, category, image, description, totalCopies } = req.body;

  if (![title, author, image, description].every(value => typeof value === 'string' && value.trim())) {
    return res.status(400).send({ msg: 'Please fill in all required book fields' });
  }

  if (!BOOK_CATEGORIES.includes(category)) {
    return res.status(400).send({ msg: 'Please select a valid book category' });
  }

  const copies = Number(totalCopies);

  if (!Number.isInteger(copies) || copies < 1) {
    return res.status(400).send({ msg: 'Total copies must be a whole number of at least 1' });
  }

  const userName = req.user.name;
  const userEmail = req.user.email;

  if (!userName || !userEmail) {
    return res.status(400).send({ msg: 'User name or email is missing' });
  }

  const newBook = {
    title: title.trim(),
    author: author.trim(),
    category,
    image: image.trim(),
    description: description.trim(),
    userName,
    userEmail,
    totalCopies: copies,
    availableCopies: copies,
    createdAt: new Date()
  };

  try {
    const result = await booksCollection.insertOne(newBook);

    res.status(201).send({ _id: result.insertedId, ...newBook });
  } catch (error) {
    console.error('Failed to add book:', error.message);
    res.status(500).send({ msg: 'Failed to add book' });
  }
});

app.patch('/books/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { title, author, category, image, description, totalCopies } = req.body;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ msg: 'Invalid book ID' });
  }


  const updates = {};
  const fields = { title, author, image, description };

  if (!Object.entries(fields).every(([key, value]) => {
    if (value === undefined) return true;
    updates[key] = typeof value === 'string' ? value.trim() : '';
    return typeof value === 'string' && !!value.trim();
  })) return res.status(400).send({ msg: 'Please fill in all required book fields correctly' });

  if (category !== undefined && !BOOK_CATEGORIES.includes(category)) {
    return res.status(400).send({ msg: 'Please select a valid book category' });
  }

  if (category !== undefined) updates.category = category;

  const copies = totalCopies === undefined ? undefined : Number(totalCopies);

  if (copies !== undefined && (!Number.isInteger(copies) || copies < 1)) {
    return res.status(400).send({ msg: 'Total copies must be a whole number of at least 1' });
  }

  try {
    const book = await booksCollection.findOne({ _id: new ObjectId(id) });

    if (!book) return res.status(404).send({ msg: 'Book not found' });
    if (book.userEmail !== req.user.email) return res.status(403).send({ msg: 'You can only update your own books' });

    const borrowed = (book.totalCopies || 0) - (book.availableCopies ?? book.totalCopies);

    if (copies !== undefined && copies < borrowed) {
      return res.status(400).send({ msg: `Total copies cannot be less than the ${borrowed} currently borrowed copies` });
    }

    if (copies !== undefined) {
      updates.totalCopies = copies;
      updates.availableCopies = copies - borrowed;
    }

    if (!Object.keys(updates).length) return res.status(400).send({ msg: 'No valid fields to update' });

    await booksCollection.updateOne({ _id: new ObjectId(id) }, { $set: updates });

    res.send(await booksCollection.findOne({ _id: new ObjectId(id) }));
  } catch (error) {
    console.error('Failed to update book:', error.message);
    res.status(500).send({ msg: 'Failed to update book' });
  }
});

app.delete('/books/:id', verifyToken, async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) return res.status(400).send({ msg: 'Invalid book ID' });

  try {
    const book = await booksCollection.findOne({ _id: new ObjectId(id) });

    if (!book) return res.status(404).send({ msg: 'Book not found' });
    if (book.userEmail !== req.user.email) return res.status(403).send({ msg: 'You can only delete your own books' });


    const borrowed = (book.totalCopies || 0) - (book.availableCopies ?? book.totalCopies);

    if (borrowed > 0) {
      return res.status(409).send({ msg: 'This book has active borrows and cannot be deleted' });
    }

    await booksCollection.deleteOne({ _id: new ObjectId(id) });

    res.send({ msg: 'Book deleted successfully' });
  } catch (error) {
    console.error('Failed to delete book:', error.message);
    res.status(500).send({ msg: 'Failed to delete book' });
  }
});


app.post('/borrows', verifyToken, async (req, res) => {
  const { bookId, returnDate } = req.body;
  const { email: userEmail } = req.user;

  if (!bookId || typeof bookId !== 'string' || !ObjectId.isValid(bookId)) {
    return res.status(400).send({ msg: 'Please provide a valid book ID' });
  }

  if (!userEmail) {
    return res.status(400).send({ msg: 'User email is missing' });
  }

  if (!returnDate || typeof returnDate !== 'string' || Number.isNaN(Date.parse(returnDate))) {
    return res.status(400).send({ msg: 'Please provide a valid return date' });
  }


  const borrowDate = new Date().toISOString().slice(0, 10);

  if (returnDate < borrowDate) {
    return res.status(400).send({ msg: 'Return date cannot be before the borrow date' });
  }

  const objectId = new ObjectId(bookId);

  try {
    const book = await booksCollection.findOne({ _id: objectId });

    if (!book) return res.status(404).send({ msg: 'Book not found' });
    if (book.userEmail === userEmail) return res.status(403).send({ msg: 'You cannot borrow your own book' });

    const alreadyBorrowed = await borrowsCollection.findOne({ bookId: objectId.toString(), userEmail });

    if (alreadyBorrowed) return res.status(409).send({ msg: 'You have already borrowed this book' });

    const updatedBook = await booksCollection.findOneAndUpdate(
      { _id: objectId, availableCopies: { $gt: 0 } },
      { $inc: { availableCopies: -1 } },
      { returnDocument: 'after' }
    );

    if (!updatedBook) return res.status(409).send({ msg: 'This book is not available right now' });

    const newBorrow = {
      bookId: objectId.toString(),
      bookTitle: book.title,
      bookImage: book.image,
      userEmail,
      borrowDate,
      returnDate
    };

    try {
      const result = await borrowsCollection.insertOne(newBorrow);
      res.status(201).send({ _id: result.insertedId, ...newBorrow });
    } catch (error) {
      await booksCollection.updateOne({ _id: objectId }, { $inc: { availableCopies: 1 } });

      if (error.code === 11000) {
        return res.status(409).send({ msg: 'You have already borrowed this book' });
      }

      throw error;
    }

  } catch (error) {
    console.error('Failed to borrow book:', error.message);
    res.status(500).send({ msg: 'Failed to borrow book' });
  }
});


app.get('/borrows', verifyToken, async (req, res) => {
  const { email: userEmail } = req.user;

  if (!userEmail) return res.status(400).send({ msg: 'User email is missing' });

  try {
    const borrows = await borrowsCollection.find({ userEmail }).toArray();
    res.send(borrows);
  } catch (error) {
    console.error('Failed to fetch borrows:', error.message);
    res.status(500).send({ msg: 'Failed to fetch borrows' });
  }
});

app.delete('/borrows/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { email: userEmail } = req.user;

  if (!ObjectId.isValid(id)) return res.status(400).send({ msg: 'Invalid borrow ID' });

  try {
    const borrow = await borrowsCollection.findOne({ _id: new ObjectId(id) });

    if (!borrow) return res.status(404).send({ msg: 'Borrow record not found' });
    if (borrow.userEmail !== userEmail) return res.status(403).send({ msg: 'You can only return your own borrows' });

    const result = await borrowsCollection.deleteOne({ _id: new ObjectId(id) });


    if (result.deletedCount === 1 && borrow.bookId && ObjectId.isValid(borrow.bookId)) {
      await booksCollection.updateOne(
        { _id: new ObjectId(borrow.bookId) },
        { $inc: { availableCopies: 1 } }
      );
    }

    res.send({ msg: 'Book returned successfully' });
  } catch (error) {
    console.error('Failed to return book:', error.message);
    res.status(500).send({ msg: 'Failed to return book' });
  }
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
