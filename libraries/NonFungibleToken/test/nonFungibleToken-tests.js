const chai = require('chai');
let chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const assert = chai.assert;
const path = require('path');

const config = require("./constants/config.json")
const utils = require('../utils/utils');
const errorMessages = require('./constants/error-messages.json');

const bytes = require('@aeternity/aepp-sdk/es/utils/bytes');
const AeSDK = require('@aeternity/aepp-sdk');
const Universal = AeSDK.Universal;
const crypto = AeSDK.Crypto;

const contractFilePath = './../contracts/non-fungible-full-token.aes';

const tokenName = "AE Token";
const tokenSymbol = "NFT";
const firstTokenId = 1;

async function getAddress(info) {
	const addressAsHex = (await info.decode("address")).value;
	return utils.decodedHexAddressToPublicAddress(addressAsHex);
}

describe('Non-fungible token', () => {

	let firstClient;
	let secondClient;
	let contentOfContract = utils.readFileRelative(path.resolve(__dirname, contractFilePath), config.filesEncoding);

	before(async () => {

		firstClient = await Universal({
			url: config.host,
			internalUrl: config.internalHost,
			keypair: config.ownerKeyPair,
			nativeMode: true,
			networkId: 'ae_devnet'
		});

		secondClient = await Universal({
			url: config.host,
			internalUrl: config.internalHost,
			keypair: config.notOwnerKeyPair,
			nativeMode: true,
			networkId: 'ae_devnet'
		});

		firstClient.setKeypair(config.ownerKeyPair)
		await firstClient.spend(1, config.notOwnerKeyPair.publicKey)
	})

	describe('Deploy contract', () => {

		it('deploying successfully', async () => {
			//Arrange
			const compiledContract = await firstClient.contractCompile(contentOfContract, {})

			//Act
			const deployPromise = compiledContract.deploy({
				initState: `("${tokenName}", "${tokenSymbol}")`,
				options: {
					ttl: config.ttl
				},
				abi: "sophia"
			});
			
			//Assert
			const deployedContract = await deployPromise;

			assert.equal(config.ownerKeyPair.publicKey, deployedContract.owner)
		})
	})

	describe('Interact with contract', () => {
		let deployedContract;
		let compiledContract;

		beforeEach(async () => {
			compiledContract = await firstClient.contractCompile(contentOfContract, {
				gas: config.gas
			})
			deployedContract = await compiledContract.deploy({
				initState: `("${tokenName}", "${tokenSymbol}")`,
				options: {
					ttl: config.ttl
				},
				abi: "sophia"
			});
		})

		describe('Read', () => {
			it('call contract read successfully', async () => {
				//Arrange

				//Act
				const callNamePromise = deployedContract.call('name', {
					options: {
						ttl: config.ttl
					}
				});
				
				const callNameResult = await callNamePromise;

				const callSymbolPromise = deployedContract.call('symbol', {
					options: {
						ttl: config.ttl
					}
				});
				
				const callSymbolResult = await callSymbolPromise;

				//Assert
				const decodedNameResult = await callNameResult.decode("string");
				const decodedSymbolResult = await callSymbolResult.decode("string");

				assert.equal(decodedNameResult.value, tokenName)
				assert.equal(decodedSymbolResult.value, tokenSymbol)
			})
		})

		describe('Contract functionality', () => {
			beforeEach(async () => {
				const deployContractPromise = deployedContract.call('mint', {
					args: `(${firstTokenId}, ${utils.publicKeyToHex(config.ownerKeyPair.publicKey)})`,
					options: {
						ttl: config.ttl
					},
					abi: "sophia"
				})
				
				await deployContractPromise;
			})

			describe('Mint', () => {
				it('should mint 1 token successfully', async () => {
					//Arrange
					const expectedBalance = 1;

					//Act
					const ownerOfPromise = deployedContract.call('ownerOf', {
						args: `(${firstTokenId})`,
						options: {
							ttl: config.ttl
						}
					});
					
					const ownerOfResult = await ownerOfPromise;

					const balanceOfPromise = deployedContract.call('balanceOf', {
						args: `(${utils.publicKeyToHex(config.ownerKeyPair.publicKey)})`,
						options: {
							ttl: config.ttl
						}
					});
					
					const balanceOfResult = await balanceOfPromise;

					//Assert
					const decodedOwnerOfResult = await ownerOfResult
					let encodedData = await decodedOwnerOfResult.decode('address')
					const ownerPublicKey = crypto.aeEncodeKey(bytes.toBytes(encodedData.value, true))

					const decodedBalanceOfResult = await balanceOfResult.decode("int");

					assert.equal(ownerPublicKey, config.ownerKeyPair.publicKey)
					assert.equal(decodedBalanceOfResult.value, expectedBalance)
				})

				it('should not mint from non-owner', async () => {
					const unauthorisedPromise = secondClient.contractCall(compiledContract.bytecode, 'sophia', deployedContract.address, "mint", {
						args: `(${firstTokenId}, ${utils.publicKeyToHex(config.ownerKeyPair.publicKey)})`,
						options: {
							ttl: config.ttl
						}
					})
					await assert.isRejected(unauthorisedPromise, errorMessages.ONLY_OWNER_CAN_MINT);
				})

				it('should not mint token with id that already exist', async () => {
					//Arrange

					//Act
					const secondDeployContractPromise = deployedContract.call('mint', {
						args: `(${firstTokenId}, ${utils.publicKeyToHex(config.ownerKeyPair.publicKey)})`,
						options: {
							ttl: config.ttl
						}
					})

					//Assert
					await assert.isRejected(secondDeployContractPromise, errorMessages.CANNOT_OVERRIDE_TOKEN);
				})
			})

			describe('Burn', () => {
				it('should burn token successfully', async () => {
					//Arrange
					const expectedBalance = 0;

					//Act
					const ownerOfPromise = deployedContract.call('burn', {
						args: `(${firstTokenId})`,
						options: {
							ttl: config.ttl
						}
					});
					
					await ownerOfPromise;

					const balanceOfPromise = deployedContract.call('balanceOf', {
						args: `(${utils.publicKeyToHex(config.ownerKeyPair.publicKey)})`,
						options: {
							ttl: config.ttl
						}
					});
					
					const balanceOfResult = await balanceOfPromise;

					//Assert
					const decodedBalanceOfResult = await balanceOfResult.decode("int");
					assert.equal(decodedBalanceOfResult.value, expectedBalance)
				})

				it('shouldn`t burn token from non-owner', async () => {
					//Arrange

					//Act
					const unauthorizedBurnPromise = secondClient.contractCall(compiledContract.bytecode, 'sophia', deployedContract.address, "burn", {
						args: `(${firstTokenId})`,
						options: {
							ttl: config.ttl
						}
					})

					//Assert
					await assert.isRejected(unauthorizedBurnPromise, errorMessages.ONLY_OWNER_CAN_TRANSFER);
				})
			})

			describe('Transfer', () => {
				it('should transfer token successfully', async () => {
					//Arrange
					const expectedBalanceOfNotOwner = 1;
					const expectedBalanceOfOwner = 0;

					//Act
					const setApprovalForAllPromise = deployedContract.call('setApprovalForAll', {
						args: `(${utils.publicKeyToHex(config.ownerKeyPair.publicKey)},${true})`,
						options: {
							ttl: config.ttl
						}
					});
					
					await setApprovalForAllPromise;

					const approvePromise = deployedContract.call('approve', {
						args: `(${firstTokenId}, ${utils.publicKeyToHex(config.notOwnerKeyPair.publicKey)})`,
						options: {
							ttl: config.ttl
						}
					});
					
					await approvePromise;

					const transferFromPromise = deployedContract.call('transferFrom', {
						args: `(${utils.publicKeyToHex(config.ownerKeyPair.publicKey)}, ${utils.publicKeyToHex(config.notOwnerKeyPair.publicKey)}, ${firstTokenId})`,
						options: {
							ttl: config.ttl
						}
					});
					
					await transferFromPromise;

					const balanceOfNotOwnerPromise = deployedContract.call('balanceOf', {
						args: `(${utils.publicKeyToHex(config.notOwnerKeyPair.publicKey)})`,
						options: {
							ttl: config.ttl
						}
					});
					
					const balanceOfNotOwnerResult = await balanceOfNotOwnerPromise;

					const balanceOwnerPromise = deployedContract.call('balanceOf', {
						args: `(${utils.publicKeyToHex(config.ownerKeyPair.publicKey)})`,
						options: {
							ttl: config.ttl
						}
					});
					
					const balanceOfOwnerResult = await balanceOwnerPromise;

					const ownerOfPromise = deployedContract.call('ownerOf', {
						args: `(${firstTokenId})`,
						options: {
							ttl: config.ttl
						}
					});
					
					const ownerOfResult = await ownerOfPromise;

					// //Assert
					const decodedBalanceOfNotOwnerResult = await balanceOfNotOwnerResult.decode("int");
					const decodedBalanceOfOwnerResult = await balanceOfOwnerResult.decode("int");
					const publicKey = await getAddress(ownerOfResult);

					assert.equal(decodedBalanceOfNotOwnerResult.value, expectedBalanceOfNotOwner)
					assert.equal(decodedBalanceOfOwnerResult.value, expectedBalanceOfOwner)
					assert.equal(publicKey, config.notOwnerKeyPair.publicKey)
				})

				it('non-owner of token shouldn`t be able to call approve', async () => {
					//Arrange

					//Act
					const unauthorizedApprovePromise = secondClient.contractCall(compiledContract.bytecode, 'sophia', deployedContract.address, "approve", {
						args: `(${firstTokenId})`,
						options: {
							ttl: config.ttl
						}
					})

					//Assert
					await assert.isRejected(unauthorizedApprovePromise, 'bad_call_data');
				})

				it('non-owner of token shouldn`t be able to call transferFrom', async () => {
					//Arrange

					//Act
					const unauthorizedTransferPromise = secondClient.contractCall(compiledContract.bytecode, 'sophia', deployedContract.address, "transferFrom", {
						args: `(${firstTokenId})`,
						options: {
							ttl: config.ttl
						}
					})

					//Assert
					await assert.isRejected(unauthorizedTransferPromise, 'bad_call_data');
				})
			})

			//TODO fix this test
			// describe('Metadata', () => {	
			// 	it('should write/read token metadata successfully', async () => {	
			// 		//Arrange	
			// 		const expectedTokenURI = "Token";	

			// 		//Act	
			// 		const setURIPromise = deployedContract.call('setTokenURI', { args: `(${firstTokenId}, "Token")`, options: { ttl: config.ttl, gas: config.gas } });	
			// 		assert.isFulfilled(setURIPromise, 'Could not call setTokenURI');	
			// 		await setURIPromise;	

			// 		const tokenURIPromise = deployedContract.call('tokenURI', { args: `(${firstTokenId}`, options: { ttl: config.ttl, gas: config.gas } });	
			// 		assert.isFulfilled(tokenURIPromise, 'Could not call approve');	
			// 		const tokenURIResult = await tokenURIPromise;	

			// 		//Assert	
			// 		const decodedTokenURIResult = await tokenURIResult.decode("string");	

			// 		assert.equal(decodedTokenURIResult, expectedTokenURI)	
			// 	})	
			// })
		})
	})
})