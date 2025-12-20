const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000;

const stripe = require('stripe')(process.env.PAYMENT_SECRET);

const crypto = require('crypto');

const admin = require('firebase-admin');

const serviceAccount = require('./loan-link-firebase-adminsdk.json');

admin.initializeApp({
	credential: admin.credential.cert(serviceAccount),
});

// loan id generator

function generateLoanId() {
	const prefix = 'LOAN'; // your brand prefix
	const date = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
	const random = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6-char random hex

	return `${prefix}-${date}-${random}`;
}

// middleware
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
	const token = req.headers.authorization;
	if (!token) {
		return res.status(401).send({ message: 'unauthorize access' });
	}
	try {
		const idToken = token.split(' ')[1];
		const decoded = await admin.auth().verifyIdToken(idToken);
		req.decoded_email = decoded.email;
		next();
	} catch (err) {
		return res.status(401).send({ message: 'unauthorize access' });
	}
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.fielwth.mongodb.net/?appName=Cluster0'`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
	serverApi: {
		version: ServerApiVersion.v1,
		strict: true,
		deprecationErrors: true,
	},
});

async function run() {
	try {
		// Connect the client to the server	(optional starting in v4.7)
		await client.connect();

		const db = client.db('Loan_link_db');
		const loanCollection = db.collection('loans');
		const loanApplicationCollection = db.collection('loanApplication');
		const userCollection = db.collection('users');
		const paymentCollection = db.collection('payments');

		const verifyAdmin = async(req,res,next) =>{
			const email = req.decoded_email;
			const query = {email};
			const user = await userCollection.findOne(query);
			if(!user || user.role !== "Admin"){
				return res.status(403).send({message: "Forbidden Access"})
			}
			next();
		}


		// loan collection API
		app.get('/all-loans', async (req, res) => {
			const cursor = loanCollection.find({ showOnHome: true });
			const result = await cursor.toArray();
			res.send(result);
		});
		app.get('/all-loans-admin', async (req, res) => {
			const email = req.query.email;
			const query = {};
			if (email) {
				query.createdBy = email;
			}
			const cursor = loanCollection.find(query).sort({ createdAt: -1 });
			const result = await cursor.toArray();
			res.send(result);
		});
		app.post('/all-loans', async (req, res) => {
			const newLoan = req.body;
			const email = req.query.email;
			newLoan.createdAt = new Date();
			newLoan.createdBy = email;
			const result = await loanCollection.insertOne(newLoan);
			res.send(result);
		});

		app.delete('/all-loans/:id', async (req, res) => {
			const id = req.params.id;
			const query = { _id: new ObjectId(id) };
			const result = await loanCollection.deleteOne(query);
			res.send(result);
		});

		// 6 loan collection api
		app.get('/six-loans', async (req, res) => {
			const cursor = loanCollection
				.find({ showOnHome: true })
				.limit(6)
				.sort({ createdAt: -1 });
			const result = await cursor.toArray();
			res.send(result);
		});
		// specific loan api
		app.get('/all-loans/:id', async (req, res) => {
			const id = req.params.id;
			const query = { _id: new ObjectId(id) };
			const result = await loanCollection.findOne(query);
			res.send(result);
		});
		app.patch('/all-loans/:id', async (req, res) => {
			const id = req.params.id;
			const query = { _id: new ObjectId(id) };
			const updatesLoans = req.body;
			const update = {
				$set: updatesLoans,
			};
			const result = await loanCollection.updateOne(query, update);
			res.send(result);
		});
		app.patch('/all-loans/:id',async (req, res) => {
			const id = req.params.id;
			const query = { _id: new ObjectId(id) };
			const showOnHome = req.body;
			const update = {
				$set: showOnHome,
			};
			const result = await loanCollection.updateOne(query, update);
			res.send(result);
		});

		// loan application
		app.get('/loan-application',verifyFBToken, async (req, res) => {
			const query = {};
			const email = req.query.email;
			if (email) {
				query.email = email;

				if (email !== req.decoded_email) {
					return res.status(403).send({ message: 'forbidden access' });
				}
			}

			const result = await loanApplicationCollection
				.find(query)
				.sort({ createdAt: -1 })
				.toArray();

			res.send(result);
		});
		app.get('/loan-applications', async (req, res) => {
			const loanStatus = req.query.loanStatus;
			const query = {};
			if (loanStatus === 'Pending') {
				query.loanStatus = loanStatus;
			}
			if (loanStatus === 'Approved') {
				query.loanStatus = loanStatus;
			}

			const result = await loanApplicationCollection
				.find(query)
				.sort({ createdAt: -1 })
				.toArray();

			res.send(result);
		});

		app.post('/loan-application', async (req, res) => {
			const loanApplication = req.body;
			const loanId = generateLoanId();
			loanApplication.createdAt = new Date();
			loanApplication.loanId = loanId;
			loanApplication.paymentStatus = 'pending';
			loanApplication.loanFee = 10;

			const result = await loanApplicationCollection.insertOne(loanApplication);
			res.send(result);
		});

		app.patch('/loan-applications/:id',async(req,res)=>{
			const id = req.params.id;
			const query = {_id: new ObjectId(id)};
			const updatedStatus = req.body;
			const update ={
				$set:{
					loanStatus:updatedStatus.loanStatus
				}
			}
			const result = await loanApplicationCollection.updateOne(query,update);
			res.send(result);
			
		})

		app.delete('/loan-application/:id/delete', async (req, res) => {
			const id = req.params.id;
			const query = { _id: new ObjectId(id) };
			const result = await loanApplicationCollection.deleteOne(query);
			res.send(result);
		});

		// payment API's

		app.post('/create-checkout-session', async (req, res) => {
			const paymentInfo = req.body;
			const amount = parseInt(paymentInfo.loanFee) * 100;
			const session = await stripe.checkout.sessions.create({
				line_items: [
					{
						price_data: {
							currency: 'usd',
							unit_amount: amount,
							product_data: {
								name: `Payment for: ${paymentInfo.loanTitle}`,
							},
						},
						quantity: 1,
					},
				],
				mode: 'payment',
				metadata: {
					loanId: paymentInfo.loanId,
					loan_tracking_id: paymentInfo.loan_Id,
				},
				customer_email: paymentInfo.email,
				success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
				cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel?`,
			});
			res.send({ url: session.url });
		});

		app.patch('/verified-payment-success', async (req, res) => {
			const sessionId = req.query.session_id;
			const session = await stripe.checkout.sessions.retrieve(sessionId);
			const transactionId = session.payment_intent;
			const query = { transactionId: transactionId };
			const paymentExist = await paymentCollection.findOne(query);
			if (paymentExist) {
				return res.send({ message: 'already exist', transactionId });
			}
			if (session.payment_status === 'paid') {
				const id = session.metadata.loanId;
				const query = { _id: new ObjectId(id) };
				const update = {
					$set: {
						paymentStatus: 'paid',
						transactionId: session.payment_intent,
						paidAt: new Date(),
					},
				};
				const result = await loanApplicationCollection.updateOne(query, update);
				const payment = {
					amount: session.amount_total / 100,
					transactionId: session.payment_intent,
					paymentStatus: session.payment_status,
					customerEmail: session.customer_email,
					loanTrackingId: session.metadata.loan_tracking_id,
					paidAt: new Date(),
				};
				if (session.payment_status === 'paid') {
					const paymentResult = await paymentCollection.insertOne(payment);
					return res.send({
						success: true,
						paymentInfo: paymentResult,
						loanID: session.metadata.loan_tracking_id,
						transactionId: session.payment_intent,
					});
				}
				return res.send(result);
			}
			res.send({ success: false });
		});

		// user collection api
		app.post('/users', async (req, res) => {
			const newUser = req.body;
			newUser.role = 'Borrower';
			newUser.createdAt = new Date();
			const email = newUser.email;

			const userExist = await userCollection.findOne({ email });
			if (userExist) {
				return res.send('user already exist');
			}
			const result = await userCollection.insertOne(newUser);
			res.send(result);
		});
		app.get('/users', async (req, res) => {
			const email = req.query.email;
			const query = {};
			if (email) {
				query.email = email;
			}
			const result = await userCollection.find(query).toArray();
			res.send(result);
		});
		app.get('/users/:id', async (req, res) => {
			const id = req.params.id;
			const query = { _id: new ObjectId(id) };
			const result = await userCollection.find(query).toArray();
			res.send(result);
		});
		app.get('/users/:email/role', async (req, res) => {
			const email = req.params.email;
			const query = { email };
			const user = await userCollection.findOne(query);
			res.send({ role: user?.role || 'Borrower' });
		});
		app.patch('/users/:id', async (req, res) => {
			const role = req.body.role;
			const id = req.params.id;
			const query = { _id: new ObjectId(id) };
			const updatedRole = {
				$set: {
					role: role,
				},
			};

			const result = await userCollection.updateOne(query, updatedRole);
			res.send(result);
		});

		// Send a ping to confirm a successful connection
		await client.db('admin').command({ ping: 1 });
		console.log(
			'Pinged your deployment. You successfully connected to MongoDB!'
		);
	} finally {
		// Ensures that the client will close when you finish/error
		// await client.close();
	}
}
run().catch(console.dir);

app.get('/', (req, res) => {
	res.send('Loan link is running');
});

app.listen(port, () => {
	console.log(`Example app listening on port ${port}`);
});
