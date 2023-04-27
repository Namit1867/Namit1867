/* global describe it before ethers */

const {
  getSelectors,
  FacetCutAction,
  removeSelectors,
  findAddressPositionInFacets
} = require('../scripts/libraries/diamond.js')

const { deployDiamond } = require('../scripts/Testnet/deploy.js')
const { assert , expect } = require('chai')
const { ethers } = require('hardhat')
const { BigNumber } = require('ethers')
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

const tokens = (decimals,n) =>{
  const x = ethers.utils.parseUnits(n.toString(),decimals.toString());
  return x;
}

describe('Test Criteria for CRYPTO-Lock', async function () {
  let diamondAddress
  let diamondCutFacet
  let diamondLoupeFacet
  let ownershipFacet
  let tx
  let receipt
  let result
  let user1
  let user2
  let deadAddress = "0x000000000000000000000000000000000000dEaD"
  const addresses = []

  before(async function () {
    [user1,user2] = await ethers.getSigners()
    diamondAddress = await deployDiamond()
    diamondCutFacet = await ethers.getContractAt('DiamondCutFacet', diamondAddress)
    diamondLoupeFacet = await ethers.getContractAt('DiamondLoupeFacet', diamondAddress)
    ownershipFacet = await ethers.getContractAt('OwnershipFacet', diamondAddress)
  })

  describe('it checks deployment',() =>{

    it('should have three facets -- call to facetAddresses function', async () => {
      for (const address of await diamondLoupeFacet.facetAddresses()) {
        addresses.push(address)
      }
  
      assert.equal(addresses.length, 9)
    })
  
    it('facets should have the right function selectors -- call to facetFunctionSelectors function', async () => {
      let selectors = getSelectors(diamondCutFacet)
      result = await diamondLoupeFacet.facetFunctionSelectors(addresses[0])
      assert.sameMembers(result, selectors)
      selectors = getSelectors(diamondLoupeFacet)
      result = await diamondLoupeFacet.facetFunctionSelectors(addresses[1])
      assert.sameMembers(result, selectors)
      selectors = getSelectors(ownershipFacet)
      result = await diamondLoupeFacet.facetFunctionSelectors(addresses[2])
      assert.sameMembers(result, selectors)
    })
  
    it('selectors should be associated to facets correctly -- multiple calls to facetAddress function', async () => {
      assert.equal(
        addresses[0],
        await diamondLoupeFacet.facetAddress('0x1f931c1c')
      )
      assert.equal(
        addresses[1],
        await diamondLoupeFacet.facetAddress('0xcdffacc6')
      )
      assert.equal(
        addresses[1],
        await diamondLoupeFacet.facetAddress('0x01ffc9a7')
      )
      assert.equal(
        addresses[2],
        await diamondLoupeFacet.facetAddress('0xf2fde38b')
      )
    })

  })
  
  describe('it checks LockFacet criterias and its combinations',() =>{
    let token;
    let diamond;
    let lockFacet;
    let unlockFacet;
    let multisigSignFacet;
    let detailsFacet;
    let nftFacet;
    let amount;
    let abiCoder;
    let priceFetcher;
    let decimals;
      
    before(async() =>{
        const Token = await ethers.getContractFactory('Token');
        token = await Token.deploy("TokenA","TokenA",9);
        await token.deployed();
        decimals = await token.decimals();
        await token.approve(diamondAddress,tokens(decimals,20000));
        assert.equal(Number(await token.allowance(user1.address,diamondAddress)),Number(tokens(decimals,20000)));

        const price = await ethers.getContractFactory('PriceFetcher');
        priceFetcher = await price.deploy();
        await priceFetcher.deployed();
  
        diamond = await ethers.getContractAt('SetAndGetFacet', diamondAddress);
        await diamond.setFeeToken(token.address);
        let feeToken = await diamond.getFeeToken();
        assert.equal(feeToken,token.address);
        await diamond.setPriceFetcher(priceFetcher.address);
        assert.equal(await diamond.getPriceFetcher(),priceFetcher.address);

        await diamond.setFeeAmount(tokens(decimals,1));
  
        let feeTypeOld = await diamond.getFeeType(token.address);
        await diamond.toggleFeeType(token.address);
        let feeTypeNew = await diamond.getFeeType(token.address);
        assert.equal(feeTypeOld,!feeTypeNew);
  
        lockFacet = await ethers.getContractAt('LockFacet', diamondAddress);
        unlockFacet = await ethers.getContractAt('UnlockFacet', diamondAddress);
        multisigSignFacet = await ethers.getContractAt('MultiSigSignFacet', diamondAddress);
        detailsFacet = await ethers.getContractAt('DetailsFacet', diamondAddress);
        nftFacet = await ethers.getContractAt('NFTFacet', diamondAddress);

        await diamond.toggleBurnAuthorise(deadAddress);
        let authorised = await diamond.checkAuthorisedBurn(deadAddress);
        assert.equal(authorised,true);

        amount = tokens(decimals,100);
        abiCoder = new ethers.utils.AbiCoder();
        
    })

    describe('Test Burn With Less Percentage',async() => {
      it('should test failure case if already the given percent is burned',async() =>{
        const totalSupply = await token.totalSupply();
        const equalBurnPercent = ethers.utils.parseEther("0.01");
        const lessBurnPercent = ethers.utils.parseEther("0.005");
        const burnAmount = (totalSupply.mul(1)).div(100);
        await token.transfer(deadAddress,burnAmount);
        expect(await token.balanceOf(deadAddress)).to.equal(burnAmount);
        const data1 = abiCoder.encode(["address","uint"], [deadAddress,equalBurnPercent]);
        const data2 = abiCoder.encode(["address","uint"], [deadAddress,lessBurnPercent]);
        await expect(lockFacet.lock(token.address,amount,["c1"],[1],[0],[["1",data1]])).to.be.revertedWith("given burn percentage is less than current burn percentage");
        await expect(lockFacet.lock(token.address,amount,["c1"],[1],[0],[["1",data2]])).to.be.revertedWith("given burn percentage is less than current burn percentage");
      })
    })

    // describe('1. should test LockFacet for relocking',async() =>{
      
    //   it('should test LockFacet `lock` function for time criteria', async () => {
    //     const data = abiCoder.encode(["uint"], [86400]);
    //     //console.log(data)
    //     const userBalanceBefore = await token.balanceOf(user1.address);
    //     //await lockFacet.lock(token.address,amount,["(","c1","o","c2",")","a","c3"],3,[1,3,6],[["0",data],["1",data2],["0",data]]);
    //     await lockFacet.lock(token.address,amount,["c1"],1,[0],[["0",data]]);
    //     const userBalanceAfter = await token.balanceOf(user1.address);
    //     const contractBalanceAfter = await token.balanceOf(lockFacet.address);
    //     const userInfo = (await detailsFacet.viewData(user1.address));
    //     let simplifiedInfo  = [];
      
    //     userInfo.forEach(element => {
    //       let ids = [];
    //       for(let j = 0 ; j < element.ids.length ; j++)
    //       ids.push(Number(element.ids[j]))
  
    //     simplifiedInfo.push({
    //       amount: Number(element.amount),
    //       token: element.token,
    //       operations: (element.operations),
    //       libTypes: (element.libTypes),
    //       ids:ids
    //     });
    //   });
    //   //expect(contractBalanceAfter).to.equal(amount);
    //   //console.log('amount--->',Number(amount));
    //   //console.log('balanceBefore',Number(userBalanceBefore));
    //   //console.log('balanceAfter',Number(userBalanceAfter));
    //   //expect(userBalanceAfter).to.equal(userBalanceBefore.sub(amount));
    //   //console.log(simplifiedInfo)
    
    //   //console.log(await detailsFacet.viewTimeData(0))
    //   })
      
    //   it('checks failure case for `unlock` function',async() =>{
    //     const condition = await detailsFacet.checkUnlock(0);
    //     expect(condition).to.be.false;
    //     const data = [0,abiCoder.encode(["uint"], [0])]
    //     await expect(unlockFacet.unlock(0,user1.address,data)).to.be.revertedWith('Unlock Conditions Mismatch');
    //   })
  
    //   it(`should move 1 Day ahead in time to match criteria`, async () => {
    //     const interval = (1 * 24 * 60 * 60);
  
    //     const blockNumBefore = await ethers.provider.getBlockNumber();
    //     const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    //     const timestampBefore = blockBefore.timestamp;
      
    //     await ethers.provider.send('evm_increaseTime', [interval]);
    //     await ethers.provider.send('evm_mine');
      
    //     const blockNumAfter = await ethers.provider.getBlockNumber();
    //     const blockAfter = await ethers.provider.getBlock(blockNumAfter);
    //     const timestampAfter = blockAfter.timestamp;
      
    //     expect(blockNumAfter).to.be.equal(blockNumBefore + 1);
    //     //expect(timestampAfter).to.be.equal(timestampBefore + interval);
    //   })
  
    //   it('should test Lockfacet `unlock` function for time criteria',async() =>{
    //     const condition = await detailsFacet.checkUnlock(0);
    //     expect(condition).to.be.true;
    //     // const userBalanceBefore = await token.balanceOf(user1.address);
    //     // const contractBalanceBefore = await token.balanceOf(lockFacet.address);
    //     //console.log('userBalanceBefore---->',Number(userBalanceBefore));
    //     //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
    //     //const userInfo = (await detailsFacet.viewData(user1.address));
    //     //console.log(Number(userInfo[0].amount));

    //     const data1 = abiCoder.encode(["uint"], [86400]);
    //     //console.log(data)
    //     const userBalanceBefore = await token.balanceOf(user1.address);
    //     //await lockFacet.lock(token.address,amount,["(","c1","o","c2",")","a","c3"],3,[1,3,6],[["0",data],["1",data2],["0",data]]);

    //     let userInfo = (await detailsFacet.viewDataById(0));
    //     console.log(Number(userInfo.amount))

    //     let data = [2,abiCoder.encode(["string[]","uint","uint[]",'tuple(uint,bytes)[]'], [["c1"],1,[0],[[0,data1]]])]
    //     await unlockFacet.unlock(0,user1.address,data);

    //     userInfo = (await detailsFacet.viewDataById(1));
    //     console.log(Number(userInfo.amount))

    //     data = [1,abiCoder.encode(["uint"], [tokens(decimals,1)])]

    //     const interval = (1 * 24 * 60 * 60);
      
    //     await ethers.provider.send('evm_increaseTime', [interval]);
    //     await ethers.provider.send('evm_mine');

    //     await unlockFacet.unlock(1,user1.address,data);
    //     // const userBalanceAfter = await token.balanceOf(user1.address);
    //     // const contractBalanceAfter = await token.balanceOf(lockFacet.address);
    //     //console.log('userBalanceAfter---->',Number(userBalanceAfter));
    //     //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
    //     // expect(userBalanceAfter).to.equal(userBalanceBefore.add((userInfo[0].amount).mul(tokens(decimals,0.1)).div(tokens(decimals,1))));
    //     // expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub((userInfo[0].amount).mul(tokens(decimals,0.1)).div(tokens(decimals,1))));
    //     // data = [1,abiCoder.encode(["uint"], [tokens(decimals,1)])]
    //     // await unlockFacet.unlock(0,user1.address,data);
    //   })
  
    // })

    describe('1. should test LockFacet for only time criteria',async() =>{
      
      it('should test LockFacet `lock` function for time criteria', async () => {
        const data = abiCoder.encode(["uint"], [86400]);
        //console.log(data)
        const userBalanceBefore = await token.balanceOf(user1.address);
        //await lockFacet.lock(token.address,amount,["(","c1","o","c2",")","a","c3"],3,[1,3,6],[["0",data],["1",data2],["0",data]]);
        await lockFacet.lock(token.address,amount,["c1"],1,[0],[["0",data]]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
      
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
  
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
        });
      });
      expect(contractBalanceAfter).to.equal(amount);
      //console.log('amount--->',Number(amount));
      //console.log('balanceBefore',Number(userBalanceBefore));
      //console.log('balanceAfter',Number(userBalanceAfter));
      expect(userBalanceAfter).to.equal(userBalanceBefore.sub(amount));
      //console.log(simplifiedInfo)
    
      //console.log(await detailsFacet.viewTimeData(0))
      })
      
      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(0);
        expect(condition).to.be.false;
        const data = [0,abiCoder.encode(["uint"], [0])]
        await expect(unlockFacet.unlock(0,user1.address,data)).to.be.revertedWith('Unlock Conditions Mismatch');
      })
  
      it(`should move 1 Day ahead in time to match criteria`, async () => {
        const interval = (1 * 24 * 60 * 60);
  
        const blockNumBefore = await ethers.provider.getBlockNumber();
        const blockBefore = await ethers.provider.getBlock(blockNumBefore);
        const timestampBefore = blockBefore.timestamp;
      
        await ethers.provider.send('evm_increaseTime', [interval]);
        await ethers.provider.send('evm_mine');
      
        const blockNumAfter = await ethers.provider.getBlockNumber();
        const blockAfter = await ethers.provider.getBlock(blockNumAfter);
        const timestampAfter = blockAfter.timestamp;
      
        expect(blockNumAfter).to.be.equal(blockNumBefore + 1);
        //expect(timestampAfter).to.be.equal(timestampBefore + interval);
      })
  
      it('should test Lockfacet `unlock` function for time criteria',async() =>{
        const condition = await detailsFacet.checkUnlock(0);
        expect(condition).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        let data = [1,abiCoder.encode(["uint"], [tokens(18,1)])]
        await unlockFacet.unlock(0,user1.address,data);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add((userInfo[0].amount).mul(tokens(18,1)).div(tokens(18,1))));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub((userInfo[0].amount).mul(tokens(18,1)).div(tokens(18,1))));
      })
  
    })

    describe('2. should test LockFacet for only burn criteria',async() =>{
  
      it('should test Lockfacet `lock` function for burn criteria',async() =>{
        const burnPercent = ethers.utils.parseEther("0.1");
        const data = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        //console.log(data)
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        await lockFacet.lock(token.address,amount,["c1"],[1],[0],[["1",data]]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
      
        userInfo.forEach(element => {
        let ids = [];
        for(let j = 0 ; j < element.ids.length ; j++)
        ids.push(Number(element.ids[j]))
  
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });
        expect(contractBalanceAfter).to.equal(amount);
        //console.log('amount--->',amount);
        expect(userBalanceAfter).to.equal(userBalanceBefore.sub(amount));
        //console.log(simplifiedInfo)
  
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(1);
        expect(condition).to.be.false;
        const data = [0,abiCoder.encode(["uint"], [0])]
        await expect(unlockFacet.unlock(1,user1.address,data)).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it(`should transfer 1/10th of user1 tokens to ${deadAddress} to match criteria`,async () => {
          let totalSupply = (await token.totalSupply());
          let amount = BigNumber.from(totalSupply).div(BigNumber.from(10));
          await token.transfer(deadAddress,amount);
      })

      it('should test LockFacet `unlock` function for burn criteria',async() =>{
        expect(await detailsFacet.checkUnlock(1)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',userBalanceBefore);
        //console.log('contractBalanceBefore---->',contractBalanceBefore);
        const userInfo = await detailsFacet.viewData(user1.address);
        //console.log(Number(userInfo[0].amount));
        const data = [0,abiCoder.encode(["uint"], [0])]
        await unlockFacet.unlock(1,user1.address,data);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',userBalanceAfter);
        //console.log('contractBalanceAfter---->',contractBalanceAfter);
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })
  
    })

    describe('3. should test LockFacet for only price criteria',async() =>{

      it('should test Lockfacet `lock` function for price criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("1.0"));
        const initialPrice = await priceFetcher.fetchTokenPrice(token.address);
        //console.log('initial price--->',Number(initialPrice));
        const targetPrice = ethers.utils.parseEther("2.0");
        const data = abiCoder.encode(["uint"], [targetPrice]);
        await lockFacet.lock(token.address,amount,["c1"],[1],[0],[["2",data]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
        
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
  
          simplifiedInfo.push({
            amount: Number(element.amount),
            token: element.token,
            operations: (element.operations),
            libTypes: (element.libTypes),
            ids:ids
          });
        });
  
        //console.log(simplifiedInfo)

        const priceData = await detailsFacet.viewPriceData(0);
        let info;
        info = ({
          token: priceData.token,
          priceAtLock: Number(priceData.priceAtLock),
          priceAtUnlock: Number(priceData.priceAtUnlock),
        })
        //console.log(info)

      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(2);
        expect(condition).to.be.false;
        const data = [0,abiCoder.encode(["uint"], [0])]
        await expect(unlockFacet.unlock(2,user1.address,data)).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it('updates the price value to target price to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("2.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("2.0"));
      })

      it('should test Lockfacet `unlock` function for price criteria',async() =>{
        const condition = await detailsFacet.checkUnlock(2);
        expect(condition).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        const data = [0,abiCoder.encode(["uint"], [0])]
        await unlockFacet.unlock(2,user1.address,data);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })

    })

    describe('4. should test LockFacet for only market cap',async() =>{

      it('should test LockFacet `lock` function for market cap criteria',async() =>{
        const currentPrice = await priceFetcher.fetchTokenPrice(token.address);
        const totalSupply = await token.totalSupply();
        const currentMarketCap = (totalSupply.mul(currentPrice)).div(tokens(decimals,1));
        //console.log(Number(currentMarketCap));
        const targetMarketCap = ethers.utils.parseEther("30000");
        const data = abiCoder.encode(["uint"], [targetMarketCap]);
        await lockFacet.lock(token.address,amount,["c1"],[1],[0],[["3",data]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
        
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
  
          simplifiedInfo.push({
            amount: Number(element.amount),
            token: element.token,
            operations: (element.operations),
            libTypes: (element.libTypes),
            ids:ids
          });
        });
  
        //console.log(simplifiedInfo)

        const priceData = await detailsFacet.viewPriceData(0);
        let info;
        info = ({
          token: priceData.token,
          priceAtLock: Number(priceData.priceAtLock),
          priceAtUnlock: Number(priceData.priceAtUnlock),
        })
        //console.log(info)
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(3);
        expect(condition).to.be.false;
        const data = [0,abiCoder.encode(["uint"], [0])]
        await expect(unlockFacet.unlock(3,user1.address,data)).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it('updates the market cap to target marketcap to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("3.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("3.0"));
        const currentPrice = await priceFetcher.fetchTokenPrice(token.address);
        const totalSupply = await token.totalSupply();
        const currentMarketCap = (totalSupply.mul(currentPrice)).div(tokens(decimals,1));
        const targetMarketCap = ethers.utils.parseEther("30000");
        expect(currentMarketCap).to.equal(targetMarketCap);
      })

      it('should test Lockfacet `unlock` function for market cap criteria',async() =>{
        const condition = await detailsFacet.checkUnlock(3);
        expect(condition).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(3,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })

    })

    describe('5. should test LockFacet for both time and burn criteria',async() =>{

      it('should test LockFacet `lock` function for time and burn criteria', async () => {
        const burnPercent = ethers.utils.parseEther("0.2");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const timeData = abiCoder.encode(["uint"], [86400]);
        //console.log(burnData,timeData);
        await lockFacet.lock(token.address,amount,["c1","a","c2"],[2],[0,2],[["0",timeData],["1",burnData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(4);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(4,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it(`should move 1 Day ahead in time to match criteria`, async () => {
        const interval = (1 * 24 * 60 * 60);

        const blockNumBefore = await ethers.provider.getBlockNumber();
        const blockBefore = await ethers.provider.getBlock(blockNumBefore);
        const timestampBefore = blockBefore.timestamp;
    
        await ethers.provider.send('evm_increaseTime', [interval]);
        await ethers.provider.send('evm_mine');
    
        const blockNumAfter = await ethers.provider.getBlockNumber();
        const blockAfter = await ethers.provider.getBlock(blockNumAfter);
        const timestampAfter = blockAfter.timestamp;
    
        expect(blockNumAfter).to.be.equal(blockNumBefore + 1);
        //expect(timestampAfter).to.be.equal(timestampBefore + interval);
      })

      it(`should transfer 1/10th of user1 tokens to ${deadAddress} to match criteria`, async () => {
        let totalSupply = (await token.totalSupply());
        let amount = BigNumber.from(totalSupply).div(BigNumber.from(10))
        await token.transfer(deadAddress,amount)
      })

      it('should check LockFacet `unlock` function for time and burn criteria',async () =>{
        expect(await detailsFacet.checkUnlock(4)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(4,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })
      

    })

    describe('6. should test LockFacet for both time and price criteria',async() =>{

      it('should test LockFacet `lock` function for time and price', async () => {
        const timeData = abiCoder.encode(["uint"], [86400]);
        const targetPrice = ethers.utils.parseEther("4.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        await lockFacet.lock(token.address,amount,["c1","a","c2"],[2],[0,2],[["0",timeData],["2",priceData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(5);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(5,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it(`should move 1 Day ahead in time to match criteria`, async () => {
        const interval = (1 * 24 * 60 * 60);
  
        const blockNumBefore = await ethers.provider.getBlockNumber();
        const blockBefore = await ethers.provider.getBlock(blockNumBefore);
        const timestampBefore = blockBefore.timestamp;
      
        await ethers.provider.send('evm_increaseTime', [interval]);
        await ethers.provider.send('evm_mine');
      
        const blockNumAfter = await ethers.provider.getBlockNumber();
        const blockAfter = await ethers.provider.getBlock(blockNumAfter);
        const timestampAfter = blockAfter.timestamp;
      
        expect(blockNumAfter).to.be.equal(blockNumBefore + 1);
        //expect(timestampAfter).to.be.equal(timestampBefore + interval);
      })

      it('updates the price value to target price to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("4.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("4.0"));
      })

      it('should check LockFacet `unlock` function for time and price criteria',async () =>{
        expect(await detailsFacet.checkUnlock(5)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(5,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })

    })

    describe('7. should test LockFacet for both time and marketCap criteria',async() =>{

      it('should test LockFacet `lock` function for time and marketCap', async () => {
        const timeData = abiCoder.encode(["uint"], [86400]);
        const targetMarketCap = ethers.utils.parseEther("50000");
        const marketCapData = abiCoder.encode(["uint"], [targetMarketCap]);
        await lockFacet.lock(token.address,amount,["c1","a","c2"],[2],[0,2],[["0",timeData],["3",marketCapData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(6);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(6,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it(`should move 1 Day ahead in time to match criteria`, async () => {
        const interval = (1 * 24 * 60 * 60);
  
        const blockNumBefore = await ethers.provider.getBlockNumber();
        const blockBefore = await ethers.provider.getBlock(blockNumBefore);
        const timestampBefore = blockBefore.timestamp;
      
        await ethers.provider.send('evm_increaseTime', [interval]);
        await ethers.provider.send('evm_mine');
      
        const blockNumAfter = await ethers.provider.getBlockNumber();
        const blockAfter = await ethers.provider.getBlock(blockNumAfter);
        const timestampAfter = blockAfter.timestamp;
      
        expect(blockNumAfter).to.be.equal(blockNumBefore + 1);
        //expect(timestampAfter).to.be.equal(timestampBefore + interval);
      })

      it('updates the market cap to target marketcap to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("5.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("5.0"));
        const currentPrice = await priceFetcher.fetchTokenPrice(token.address);
        const totalSupply = await token.totalSupply();
        const currentMarketCap = (totalSupply.mul(currentPrice)).div(tokens(decimals,1));
        const targetMarketCap = ethers.utils.parseEther("50000");
        expect(currentMarketCap).to.equal(targetMarketCap);
        
      })

      it('should check LockFacet `unlock` function for time and marketCap criteria',async () =>{
        expect(await detailsFacet.checkUnlock(6)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(6,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })


    })

    describe('8. should test LockFacet for both burn and price criteria',async() =>{

      it('should test LockFacet `lock` function for burn and price criteria', async () => {
        const burnPercent = ethers.utils.parseEther("0.3");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const targetPrice = ethers.utils.parseEther("6.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        await lockFacet.lock(token.address,amount,["c1","a","c2"],[2],[0,2],[["1",burnData],["2",priceData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(7);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(7,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it(`should transfer 1/10th of user1 tokens to ${deadAddress} to match criteria`, async () => {
        let totalSupply = (await token.totalSupply());
        let amount = BigNumber.from(totalSupply).div(BigNumber.from(10))
        await token.transfer(deadAddress,amount)
      })

      it('updates the price value to target price to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("6.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("6.0"));
      })

      it('should check LockFacet `unlock` function for burn and price criteria',async () =>{
        expect(await detailsFacet.checkUnlock(7)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(7,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })


    })

    describe('9. should test LockFacet for both burn and marketcap criteria',async() =>{
      
      it('should test LockFacet `lock` function for burn and marketcap criteria', async () => {
        const burnPercent = ethers.utils.parseEther("0.4");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const targetMarketCap = ethers.utils.parseEther("70000");
        const marketCapData = abiCoder.encode(["uint"], [targetMarketCap]);
        await lockFacet.lock(token.address,amount,["c1","a","c2"],[2],[0,2],[["1",burnData],["3",marketCapData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(8);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(8,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it(`should transfer 1/10th of user1 tokens to ${deadAddress} to match criteria`, async () => {
        let totalSupply = (await token.totalSupply());
        let amount = BigNumber.from(totalSupply).div(BigNumber.from(10));
        await token.transfer(deadAddress,amount)
      })

      it('updates the market cap to target marketcap to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("7.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("7.0"));
        const currentPrice = await priceFetcher.fetchTokenPrice(token.address);
        const totalSupply = await token.totalSupply();
        const currentMarketCap = (totalSupply.mul(currentPrice)).div(tokens(decimals,1));
        const targetMarketCap = ethers.utils.parseEther("70000");
        expect(currentMarketCap).to.equal(targetMarketCap);
        
      })

      it('should check LockFacet `unlock` function for burn and marketcap criteria',async () =>{
        //expect(await detailsFacet.checkUnlock(8)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(8,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })

    })

    describe('10. should test LockFacet for both price and market cap criteria',async() =>{

      it('should test LockFacet `lock` function for price and market cap',async() =>{
        const targetPrice = ethers.utils.parseEther("8.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        const targetMarketCap = ethers.utils.parseEther("80000");
        const marketCapData = abiCoder.encode(["uint"], [targetMarketCap]);
        await lockFacet.lock(token.address,amount,["c1","a","c2"],[2],[0,2],[["2",priceData],["3",marketCapData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
            ids.push(Number(element.ids[j]))

          simplifiedInfo.push({
            amount: Number(element.amount),
            token: element.token,
            operations: (element.operations),
            libTypes: (element.libTypes),
            ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
              })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
           }
          }
        }
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(9);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(9,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it('updates price and marketcap to match the criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("8.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("8.0"));
        const currentPrice = await priceFetcher.fetchTokenPrice(token.address);
        const totalSupply = await token.totalSupply();
        const currentMarketCap = (totalSupply.mul(currentPrice)).div(tokens(decimals,1));
        const targetMarketCap = ethers.utils.parseEther("80000");
        expect(currentMarketCap).to.equal(targetMarketCap);

      })

      it('should test Lockfacet `unlock` function for both price and market cap criteria',async() =>{
        const condition = await detailsFacet.checkUnlock(9);
        expect(condition).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(9,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })

    })

    describe('11. should test LockFacet for time and burn and price criterias',async() =>{

      it('should test LockFacet `lock` function for time and burn and price', async () => {
        const burnPercent = ethers.utils.parseEther("0.5");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const timeData = abiCoder.encode(["uint"], [86400]);
        const targetPrice = ethers.utils.parseEther("9.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        await lockFacet.lock(token.address,amount,["c1","a","c2","a","c3"],[3],[0,2,4],[["0",timeData],["1",burnData],["2",priceData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(10);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(10,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it(`should move 1 Day ahead in time to match criteria`, async () => {
        const interval = (1 * 24 * 60 * 60);
  
        const blockNumBefore = await ethers.provider.getBlockNumber();
        const blockBefore = await ethers.provider.getBlock(blockNumBefore);
        const timestampBefore = blockBefore.timestamp;
      
        await ethers.provider.send('evm_increaseTime', [interval]);
        await ethers.provider.send('evm_mine');
      
        const blockNumAfter = await ethers.provider.getBlockNumber();
        const blockAfter = await ethers.provider.getBlock(blockNumAfter);
        const timestampAfter = blockAfter.timestamp;
      
        expect(blockNumAfter).to.be.equal(blockNumBefore + 1);
        //expect(timestampAfter).to.be.equal(timestampBefore + interval);
      })

      it(`should transfer 1/10th of user1 tokens to ${deadAddress} to match criteria`,async () => {
        let totalSupply = (await token.totalSupply());
        let amount = BigNumber.from(totalSupply).div(BigNumber.from(10));
        await token.transfer(deadAddress,amount);
      })

      it('updates the price value to target price to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("9.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("9.0"));
      })

      it('should check LockFacet `unlock` function for time and burn and price criteria',async () =>{
        expect(await detailsFacet.checkUnlock(10)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(10,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })
      
    })

    describe('12. should test LockFacet for time and burn and marketcap criterias',async() =>{

      it('should test LockFacet `lock` function for time and burn and marketcap', async () => {
        const burnPercent = ethers.utils.parseEther("0.6");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const timeData = abiCoder.encode(["uint"], [86400]);
        const targetMarketCap = ethers.utils.parseEther("100000");
        const marketCapData = abiCoder.encode(["uint"], [targetMarketCap]);
        await lockFacet.lock(token.address,amount,["c1","a","c2","a","c3"],[3],[0,2,4],[["0",timeData],["1",burnData],["3",marketCapData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(11);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(11,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it(`should move 1 Day ahead in time to match criteria`, async () => {
        const interval = (1 * 24 * 60 * 60);
  
        const blockNumBefore = await ethers.provider.getBlockNumber();
        const blockBefore = await ethers.provider.getBlock(blockNumBefore);
        const timestampBefore = blockBefore.timestamp;
      
        await ethers.provider.send('evm_increaseTime', [interval]);
        await ethers.provider.send('evm_mine');
      
        const blockNumAfter = await ethers.provider.getBlockNumber();
        const blockAfter = await ethers.provider.getBlock(blockNumAfter);
        const timestampAfter = blockAfter.timestamp;
      
        expect(blockNumAfter).to.be.equal(blockNumBefore + 1);
        //expect(timestampAfter).to.be.equal(timestampBefore + interval);
      })

      it(`should transfer 1/10th of user1 tokens to ${deadAddress} to match criteria`,async () => {
        let totalSupply = (await token.totalSupply());
        let amount = BigNumber.from(totalSupply).div(BigNumber.from(10));
        await token.transfer(deadAddress,amount);
      })

      it('updates the price value to target price to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("10.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("10.0"));
        const currentPrice = await priceFetcher.fetchTokenPrice(token.address);
        const totalSupply = await token.totalSupply();
        const currentMarketCap = (totalSupply.mul(currentPrice)).div(tokens(decimals,1));
        const targetMarketCap = ethers.utils.parseEther("100000");
        expect(currentMarketCap).to.equal(targetMarketCap);

      })

      it('should check LockFacet `unlock` function for time and burn and marketcap criteria',async () =>{
        expect(await detailsFacet.checkUnlock(11)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(11,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })
      

    })

    describe('13. should test LockFacet for time and price and market cap criterias',async() =>{

      it('should test LockFacet `lock` function for time and price and marketcap', async () => {
        const timeData = abiCoder.encode(["uint"], [86400]);
        const targetPrice = ethers.utils.parseEther("11.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        const targetMarketCap = ethers.utils.parseEther("110000");
        const marketCapData = abiCoder.encode(["uint"], [targetMarketCap]);
        await lockFacet.lock(token.address,amount,["c1","a","c2","a","c3"],[3],[0,2,4],[["0",timeData],["2",priceData],["3",marketCapData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(12);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(12,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it('updates the price value to target price and marketcap to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("11.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("11.0"));
        const currentPrice = await priceFetcher.fetchTokenPrice(token.address);
        const totalSupply = await token.totalSupply();
        const currentMarketCap = (totalSupply.mul(currentPrice)).div(tokens(decimals,1));
        const targetMarketCap = ethers.utils.parseEther("110000");
        expect(currentMarketCap).to.equal(targetMarketCap);
      })

      it(`should move 1 Day ahead in time to match criteria`, async () => {
        const interval = (1 * 24 * 60 * 60);
  
        const blockNumBefore = await ethers.provider.getBlockNumber();
        const blockBefore = await ethers.provider.getBlock(blockNumBefore);
        const timestampBefore = blockBefore.timestamp;
      
        await ethers.provider.send('evm_increaseTime', [interval]);
        await ethers.provider.send('evm_mine');
      
        const blockNumAfter = await ethers.provider.getBlockNumber();
        const blockAfter = await ethers.provider.getBlock(blockNumAfter);
        const timestampAfter = blockAfter.timestamp;
      
        expect(blockNumAfter).to.be.equal(blockNumBefore + 1);
        //expect(timestampAfter).to.be.equal(timestampBefore + interval);
      })

      it('should check LockFacet `unlock` function for time and price and marketcap criteria',async () =>{
        expect(await detailsFacet.checkUnlock(12)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(12,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })

    })

    describe('14. should test LockFacet for burn and price and marketcap criteria,',async() =>{

      it('should test LockFacet `lock` function for burn and price and marketcap', async () => {
        const burnPercent = ethers.utils.parseEther("0.7");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const targetPrice = ethers.utils.parseEther("12.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        const targetMarketCap = ethers.utils.parseEther("120000");
        const marketCapData = abiCoder.encode(["uint"], [targetMarketCap]);
        await lockFacet.lock(token.address,amount,["c1","a","c2","a","c3"],[3],[0,2,4],[["1",burnData],["2",priceData],["3",marketCapData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(13);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(13,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it(`should transfer 1/10th of user1 tokens to ${deadAddress} to match criteria`,async () => {
        let totalSupply = (await token.totalSupply());
        let amount = BigNumber.from(totalSupply).div(BigNumber.from(10));
        await token.transfer(deadAddress,amount);
      })

      it('updates the price value to target price to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("12.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("12.0"));
      })

      it('should check LockFacet `unlock` function for burn and price and marketcap criteria',async () =>{
        expect(await detailsFacet.checkUnlock(13)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(13,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })

    })

    describe('15. should test LockFacet for time and burn and price and market cap criterias',async() =>{

      it('should test LockFacet `lock` function for time and burn and price and marketcap', async () => {
        const burnPercent = ethers.utils.parseEther("0.8");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const timeData = abiCoder.encode(["uint"], [86400]);
        const targetPrice = ethers.utils.parseEther("13.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        const targetMarketCap = ethers.utils.parseEther("130000");
        const marketCapData = abiCoder.encode(["uint"], [targetMarketCap]);
        await lockFacet.lock(token.address,amount,["c1","a","c2","a","c3","a","c4"],[4],[0,2,4,6],[["0",timeData],["1",burnData],["2",priceData],["3",marketCapData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(14);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(14,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it(`should move 1 Day ahead in time to match criteria`, async () => {
        const interval = (1 * 24 * 60 * 60);
  
        const blockNumBefore = await ethers.provider.getBlockNumber();
        const blockBefore = await ethers.provider.getBlock(blockNumBefore);
        const timestampBefore = blockBefore.timestamp;
      
        await ethers.provider.send('evm_increaseTime', [interval]);
        await ethers.provider.send('evm_mine');
      
        const blockNumAfter = await ethers.provider.getBlockNumber();
        const blockAfter = await ethers.provider.getBlock(blockNumAfter);
        const timestampAfter = blockAfter.timestamp;
      
        expect(blockNumAfter).to.be.equal(blockNumBefore + 1);
        //expect(timestampAfter).to.be.equal(timestampBefore + interval);
      })

      it(`should transfer 1/10th of user1 tokens to ${deadAddress} to match criteria`,async () => {
        let totalSupply = (await token.totalSupply());
        let amount = BigNumber.from(totalSupply).div(BigNumber.from(10));
        await token.transfer(deadAddress,amount);
      })

      it('updates the price value to target price to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("13.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("13.0"));
      })

      it('should check LockFacet `unlock` function for time and burn and price and marketcap criteria',async () =>{
        expect(await detailsFacet.checkUnlock(14)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(14,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })
      
    })

    describe('16. should test LockFacet if only time criteria is satisfied for either time or burn condition',async() =>{

      it('should test LockFacet `lock` function for time or burn criteria', async () => {
        const burnPercent = ethers.utils.parseEther("0.9");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const timeData = abiCoder.encode(["uint"], [86400]);
        //console.log(burnData,timeData);
        //await lockFacet.lock(token.address,amount,[],[["0",data]]);
        await lockFacet.lock(token.address,amount,["c1","o","c2"],[2],[0,2],[["0",timeData],["1",burnData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
            ids.push(Number(element.ids[j]))

          simplifiedInfo.push({
            amount: Number(element.amount),
            token: element.token,
            operations: (element.operations),
            libTypes: (element.libTypes),
            ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
              })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
           }
          }
        }
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(15);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(15,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it(`should move 1 Day ahead in time to match criteria`, async () => {
        const interval = (1 * 24 * 60 * 60);

        const blockNumBefore = await ethers.provider.getBlockNumber();
        const blockBefore = await ethers.provider.getBlock(blockNumBefore);
        const timestampBefore = blockBefore.timestamp;
    
        await ethers.provider.send('evm_increaseTime', [interval]);
        await ethers.provider.send('evm_mine');
    
        const blockNumAfter = await ethers.provider.getBlockNumber();
        const blockAfter = await ethers.provider.getBlock(blockNumAfter);
        const timestampAfter = blockAfter.timestamp;
    
        expect(blockNumAfter).to.be.equal(blockNumBefore + 1);
        //expect(timestampAfter).to.be.equal(timestampBefore + interval);
      })

      it('should check LockFacet `unlock` function for time or burn criteria',async () =>{
        expect(await detailsFacet.checkUnlock(15)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = await detailsFacet.viewData(user1.address);
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(15,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));
      })

    })

    describe('17. should test LockFacet if only burn criteria is satisfied for either time or burn condition',async() =>{

      it('should test LockFacet `lock` function for time or burn criteria', async () => {
        const burnPercent = ethers.utils.parseEther("0.9");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const timeData = abiCoder.encode(["uint"], [86400]);
        //console.log(burnData,timeData);
        //await lockFacet.lock(token.address,amount,[],[["0",data]]);
        await lockFacet.lock(token.address,amount,["c1","o","c2"],[2],[0,2],[["0",timeData],["1",burnData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
            ids.push(Number(element.ids[j]))

          simplifiedInfo.push({
            amount: Number(element.amount),
            token: element.token,
            operations: (element.operations),
            libTypes: (element.libTypes),
            ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
              })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
           }
          }
        }
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(16);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(16,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it(`should transfer 1/10th of user1 tokens to ${deadAddress} to match criteria`, async () => {
        let totalSupply = (await token.totalSupply());
        let amount = BigNumber.from(totalSupply).div(BigNumber.from(10));
        await token.transfer(deadAddress,amount);
      })

      it('should check LockFacet `unlock` function for time or burn criteria',async () =>{
        expect(await detailsFacet.checkUnlock(16)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = await detailsFacet.viewData(user1.address);
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(16,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));
      })

    })

    describe('18. should test LockFacet if only price criteria is satisfied for either price or marketcap condition',async() =>{

      it('should test LockFacet `lock` function for either price or market cap',async() =>{
        const targetPrice = ethers.utils.parseEther("14.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        const targetMarketCap = ethers.utils.parseEther("150000");
        const marketCapData = abiCoder.encode(["uint"], [targetMarketCap]);
        await lockFacet.lock(token.address,amount,["c1","o","c2"],[2],[0,2],[["2",priceData],["3",marketCapData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
            ids.push(Number(element.ids[j]))

          simplifiedInfo.push({
            amount: Number(element.amount),
            token: element.token,
            operations: (element.operations),
            libTypes: (element.libTypes),
            ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
              })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
           }
          }
        }
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(17);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(17,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it('updates the price value to target price to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("14.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("14.0"));
      })

      it('should test Lockfacet `unlock` function for either price or market cap criteria',async() =>{
        const condition = await detailsFacet.checkUnlock(17);
        expect(condition).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(17,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })


    })

    describe('19. should test LockFacet if only marketcap criteria is satisfied for either price or marketcap condition',async() =>{

      it('should test LockFacet `lock` function for either price or market cap',async() =>{
        const targetPrice = ethers.utils.parseEther("16.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        const targetMarketCap = ethers.utils.parseEther("150000");
        const marketCapData = abiCoder.encode(["uint"], [targetMarketCap]);
        await lockFacet.lock(token.address,amount,["c1","o","c2"],[2],[0,2],[["2",priceData],["3",marketCapData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
            ids.push(Number(element.ids[j]))

          simplifiedInfo.push({
            amount: Number(element.amount),
            token: element.token,
            operations: (element.operations),
            libTypes: (element.libTypes),
            ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
              })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
           }
          }
        }
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(18);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(18,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it('updates the market cap to target marketcap to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("15.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("15.0"));
        const currentPrice = await priceFetcher.fetchTokenPrice(token.address);
        const totalSupply = await token.totalSupply();
        const currentMarketCap = (totalSupply.mul(currentPrice)).div(tokens(decimals,1));
        const targetMarketCap = ethers.utils.parseEther("150000");
        expect(currentMarketCap).to.equal(targetMarketCap);
        
      })

      it('should test Lockfacet `unlock` function for either price or market cap criteria',async() =>{
        const condition = await detailsFacet.checkUnlock(18);
        expect(condition).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(18,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })


    })

    describe('20. should test LockFacet if only time criteria is satisfied for either time or price criteria',async() =>{

      it('should test LockFacet `lock` function for time or price', async () => {
        const timeData = abiCoder.encode(["uint"], [86400]);
        const targetPrice = ethers.utils.parseEther("100.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        await lockFacet.lock(token.address,amount,["c1","o","c2"],[2],[0,2],[["0",timeData],["2",priceData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(19);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(19,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it(`should move 1 Day ahead in time to match criteria`, async () => {
        const interval = (1 * 24 * 60 * 60);
  
        const blockNumBefore = await ethers.provider.getBlockNumber();
        const blockBefore = await ethers.provider.getBlock(blockNumBefore);
        const timestampBefore = blockBefore.timestamp;
      
        await ethers.provider.send('evm_increaseTime', [interval]);
        await ethers.provider.send('evm_mine');
      
        const blockNumAfter = await ethers.provider.getBlockNumber();
        const blockAfter = await ethers.provider.getBlock(blockNumAfter);
        const timestampAfter = blockAfter.timestamp;
      
        expect(blockNumAfter).to.be.equal(blockNumBefore + 1);
        //expect(timestampAfter).to.be.equal(timestampBefore + interval);
      })

      it('should check LockFacet `unlock` function for time or price criteria',async () =>{
        expect(await detailsFacet.checkUnlock(19)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(19,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })

    })

    describe('21. should test LockFacet if only price criteria is satisfied for either time or price criteria',async() =>{

      it('should test LockFacet `lock` function for time or price', async () => {
        const timeData = abiCoder.encode(["uint"], [86400]);
        const targetPrice = ethers.utils.parseEther("16.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        await lockFacet.lock(token.address,amount,["c1","o","c2"],[2],[0,2],[["0",timeData],["2",priceData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(20);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(20,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it('updates the market cap to target marketcap to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("16.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("16.0"));
        
      })

      it('should check LockFacet `unlock` function for time or price criteria',async () =>{
        expect(await detailsFacet.checkUnlock(20)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(20,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })

    })

    describe('22 .should test LockFacet if only marketcap criteria is satisfied for either burn or marketcap criteria',async() =>{

      it('should test LockFacet `lock` function for burn or marketcap criteria', async () => {
        const burnPercent = ethers.utils.parseEther("1");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const targetMarketCap = ethers.utils.parseEther("170000");
        const marketCapData = abiCoder.encode(["uint"], [targetMarketCap]);
        await lockFacet.lock(token.address,amount,["c1","o","c2"],[2],[0,2],[["1",burnData],["3",marketCapData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(21);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(21,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it('updates the market cap to target marketcap to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("17.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("17.0"));
        const currentPrice = await priceFetcher.fetchTokenPrice(token.address);
        const totalSupply = await token.totalSupply();
        const currentMarketCap = (totalSupply.mul(currentPrice)).div(tokens(decimals,1));
        const targetMarketCap = ethers.utils.parseEther("170000");
        expect(currentMarketCap).to.equal(targetMarketCap);
        
      })

      it('should check LockFacet `unlock` function for burn or marketcap criteria',async () =>{
        expect(await detailsFacet.checkUnlock(21)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(21,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })

    })

    describe('23. should test LockFacet if only time criteria is satisfied for time or burn or price criteria',async() =>{

      it('should test LockFacet `lock` function for time or burn or price', async () => {
        const burnPercent = ethers.utils.parseEther("1");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const timeData = abiCoder.encode(["uint"], [86400]);
        const targetPrice = ethers.utils.parseEther("18.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        await lockFacet.lock(token.address,amount,["c1","o","c2","o","c3"],[3],[0,2,4],[["0",timeData],["1",burnData],["2",priceData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(22);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(22,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it(`should move 1 Day ahead in time to match criteria`, async () => {
        const interval = (1 * 24 * 60 * 60);
  
        const blockNumBefore = await ethers.provider.getBlockNumber();
        const blockBefore = await ethers.provider.getBlock(blockNumBefore);
        const timestampBefore = blockBefore.timestamp;
      
        await ethers.provider.send('evm_increaseTime', [interval]);
        await ethers.provider.send('evm_mine');
      
        const blockNumAfter = await ethers.provider.getBlockNumber();
        const blockAfter = await ethers.provider.getBlock(blockNumAfter);
        const timestampAfter = blockAfter.timestamp;
      
        expect(blockNumAfter).to.be.equal(blockNumBefore + 1);
        //expect(timestampAfter).to.be.equal(timestampBefore + interval);
      })

      it('should check LockFacet `unlock` function for time or burn or price criteria',async () =>{
        expect(await detailsFacet.checkUnlock(22)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(22,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })
      

    })

    describe('24. should test LockFacet if only price criteria is satisfied for time or burn or price or marketcap',async() =>{

      it('should test LockFacet `lock` function for time or burn or price or marketcap', async () => {
        const burnPercent = ethers.utils.parseEther("1");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const timeData = abiCoder.encode(["uint"], [86400]);
        const targetPrice = ethers.utils.parseEther("18.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        const targetMarketCap = ethers.utils.parseEther("190000");
        const marketCapData = abiCoder.encode(["uint"], [targetMarketCap]);
        await lockFacet.lock(token.address,amount,["c1","o","c2","o","c3","o","c4"],[4],[0,2,4,6],[["0",timeData],["1",burnData],["2",priceData],["3",marketCapData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(23);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(23,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it('updates the price value to target price to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("18.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("18.0"));
      })

      it('should check LockFacet `unlock` function for time or burn or price or marketcap criteria',async () =>{
        expect(await detailsFacet.checkUnlock(23)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(23,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })

    })

    describe('25. should test LockFacet for (time and burn) or price criterias',async() =>{

      it('should test LockFacet `lock` function for (time and burn) or price', async () => {
        const burnPercent = ethers.utils.parseEther("1");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const timeData = abiCoder.encode(["uint"], [86400]);
        const targetPrice = ethers.utils.parseEther("19.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        await lockFacet.lock(token.address,amount,["(","c1","a","c2",")","o","c3"],[3],[1,3,6],[["0",timeData],["1",burnData],["2",priceData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(24);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(24,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it('updates the price value to target price to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("19.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("19.0"));
      })

      it('should check LockFacet `unlock` function for (time and burn) or price criteria',async () =>{
        expect(await detailsFacet.checkUnlock(24)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(24,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })
      
    })

    describe('26. should test LockFacet for time and (burn or price) criterias',async() =>{

      it('should test LockFacet `lock` function for time and (burn or price)', async () => {
        const burnPercent = ethers.utils.parseEther("1");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const timeData = abiCoder.encode(["uint"], [86400]);
        const targetPrice = ethers.utils.parseEther("20.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        await lockFacet.lock(token.address,amount,["c1","a","(","c2","o","c3",")"],[3],[0,3,5],[["0",timeData],["1",burnData],["2",priceData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(25);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(25,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it(`should move 1 Day ahead in time to match criteria`, async () => {
        const interval = (1 * 24 * 60 * 60);
  
        const blockNumBefore = await ethers.provider.getBlockNumber();
        const blockBefore = await ethers.provider.getBlock(blockNumBefore);
        const timestampBefore = blockBefore.timestamp;
      
        await ethers.provider.send('evm_increaseTime', [interval]);
        await ethers.provider.send('evm_mine');
      
        const blockNumAfter = await ethers.provider.getBlockNumber();
        const blockAfter = await ethers.provider.getBlock(blockNumAfter);
        const timestampAfter = blockAfter.timestamp;
      
        expect(blockNumAfter).to.be.equal(blockNumBefore + 1);
        //expect(timestampAfter).to.be.equal(timestampBefore + interval);
      })

      it('updates the price value to target price to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("20.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("20.0"));
      })

      it('should check LockFacet `unlock` function for (time and burn) or price criteria',async () =>{
        expect(await detailsFacet.checkUnlock(25)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(25,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })
      
    })

    describe('27. should test LockFacet for (burn or price) and marketcap criteria,',async() =>{

      it('should test LockFacet `lock` function for (burn or price) and marketcap', async () => {
        const burnPercent = ethers.utils.parseEther("1");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const targetPrice = ethers.utils.parseEther("21.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        const targetMarketCap = ethers.utils.parseEther("210000");
        const marketCapData = abiCoder.encode(["uint"], [targetMarketCap]);
        await lockFacet.lock(token.address,amount,["(","c1","o","c2",")","a","c3"],[3],[1,3,6],[["1",burnData],["2",priceData],["3",marketCapData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(26);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(26,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it('updates the price value to target price to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("21.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("21.0"));
      })

      it('should check LockFacet `unlock` function for (burn or price) and marketcap criteria',async () =>{
        expect(await detailsFacet.checkUnlock(26)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(26,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })

    })

    describe('28. should test LockFacet for (time or burn) and (price or market cap) criterias',async() =>{

      it('should test LockFacet `lock` function for (time or burn) and (price or marketcap)', async () => {
        const burnPercent = ethers.utils.parseEther("1");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const timeData = abiCoder.encode(["uint"], [86400]);
        const targetPrice = ethers.utils.parseEther("22.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        const targetMarketCap = ethers.utils.parseEther("220000");
        const marketCapData = abiCoder.encode(["uint"], [targetMarketCap]);
        await lockFacet.lock(token.address,amount,["(","c1","o","c2",")","a","(","c3","o","c4",")"],[4],[1,3,7,9],[["0",timeData],["1",burnData],["2",priceData],["3",marketCapData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(27);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(27,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it(`should move 1 Day ahead in time to match criteria`, async () => {
        const interval = (1 * 24 * 60 * 60);
  
        const blockNumBefore = await ethers.provider.getBlockNumber();
        const blockBefore = await ethers.provider.getBlock(blockNumBefore);
        const timestampBefore = blockBefore.timestamp;
      
        await ethers.provider.send('evm_increaseTime', [interval]);
        await ethers.provider.send('evm_mine');
      
        const blockNumAfter = await ethers.provider.getBlockNumber();
        const blockAfter = await ethers.provider.getBlock(blockNumAfter);
        const timestampAfter = blockAfter.timestamp;
      
        expect(blockNumAfter).to.be.equal(blockNumBefore + 1);
        //expect(timestampAfter).to.be.equal(timestampBefore + interval);
      })

      it('updates the price value to target price to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("22.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("22.0"));
      })

      it('should check LockFacet `unlock` function for (time or burn) and (price or marketcap) criteria',async () =>{
        expect(await detailsFacet.checkUnlock(27)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(27,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })
      
    })

    describe('29. should test LockFacet for ((time or burn) and price) or market cap criterias',async() =>{

      it('should test LockFacet `lock` function for ((time or burn) and price) or marketcap', async () => {
        const burnPercent = ethers.utils.parseEther("1");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const timeData = abiCoder.encode(["uint"], [86400]);
        const targetPrice = ethers.utils.parseEther("23.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        const targetMarketCap = ethers.utils.parseEther("230000");
        const marketCapData = abiCoder.encode(["uint"], [targetMarketCap]);
        await lockFacet.lock(token.address,amount,["(","(","c1","o","c2",")","a","c3",")","o","c4"],[4],[2,4,7,10],[["0",timeData],["1",burnData],["2",priceData],["3",marketCapData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(28);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(28,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it('updates the price value to target price to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("23.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("23.0"));
      })

      it('should check LockFacet `unlock` function for ((time or burn) and price)) or marketcap criteria',async () =>{
        expect(await detailsFacet.checkUnlock(28)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(28,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })
      
    })

    describe('30. should test LockFacet for ((time and burn) or price) and market cap criterias',async() =>{

      it('should test LockFacet `lock` function for ((time and burn) or price) and market cap criterias', async () => {
        
        const burnPercent = ethers.utils.parseEther("1");
        const burnData = abiCoder.encode(["address","uint"], [deadAddress,burnPercent]);
        const timeData = abiCoder.encode(["uint"], [86400]);
        const targetPrice = ethers.utils.parseEther("24.0");
        const priceData = abiCoder.encode(["uint"], [targetPrice]);
        const targetMarketCap = ethers.utils.parseEther("240000");
        const marketCapData = abiCoder.encode(["uint"], [targetMarketCap]);
        await lockFacet.lock(token.address,amount,["(","(","c1","a","c2",")","o","c3",")","a","c4"],[4],[2,4,7,10],[["0",timeData],["1",burnData],["2",priceData],["3",marketCapData]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
    
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
 
        simplifiedInfo.push({
          amount: Number(element.amount),
          token: element.token,
          operations: (element.operations),
          libTypes: (element.libTypes),
          ids:ids
          });
        });

        //console.log(simplifiedInfo)

        for(let i = 0; i < simplifiedInfo.length; i++){
          const libTypes = simplifiedInfo[i].libTypes;
          const ids = simplifiedInfo[i].ids;
          for(j = 0; j < libTypes.length; j++){
            let info;
            const libType = libTypes[j];
            if(libType == 0){
              const data = await detailsFacet.viewTimeData(ids[j])
              info = ({
              lockTime: Number(data.lockTime),
              unlockTime: Number(data.unlockTime),
            })
              //console.log(info);
            } else if (libType ==1){
              const data = await detailsFacet.viewBurnData(ids[j])
              info = ({
                burnPercentage: Number(data.burnPercentage),
                burnAddress: data.burnAddress,
                token: data.token,
              })
              //console.log(info);
            }
          }
        }
    
        //console.log(await detailsFacet.viewTimeData(0))
      })

      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(29);
        expect(condition).to.be.false;
        await expect(unlockFacet.unlock(29,user1.address,[0,abiCoder.encode(["uint"], [0])])).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it('updates the price value to target price to match criteria',async() =>{
        await priceFetcher.setTokenPrice(token.address,ethers.utils.parseEther("24.0"));
        expect(await priceFetcher.fetchTokenPrice(token.address)).to.equal(ethers.utils.parseEther("24.0"));
      })

      it('should check LockFacet `unlock` function for ((time and burn) or price) and market cap criterias',async () =>{
        expect(await detailsFacet.checkUnlock(29)).to.be.true;
        const userBalanceBefore = await token.balanceOf(user1.address);
        const contractBalanceBefore = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceBefore---->',Number(userBalanceBefore));
        //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
        const userInfo = (await detailsFacet.viewData(user1.address));
        //console.log(Number(userInfo[0].amount));
        await unlockFacet.unlock(29,user1.address,[0,abiCoder.encode(["uint"], [0])]);
        const userBalanceAfter = await token.balanceOf(user1.address);
        const contractBalanceAfter = await token.balanceOf(lockFacet.address);
        //console.log('userBalanceAfter---->',Number(userBalanceAfter));
        //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
        expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));

      })
      
    })

    describe('31. should test LockFacet for only multisig criteria',async() =>{

      it('should test Lockfacet `lock` function for multisig criteria using merkle tree',async() =>{
  
        const [user3,user4,user5,user6] = await ethers.getSigners()
  
        let addresses = [
          user3.address,
          user4.address,
          user5.address
        ];
  
        // Hash leaves
        const leaves = addresses.map((addr) => keccak256(addr));
        tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        root = tree.getHexRoot();
  
        let threshold = 3;
        let signers = addresses;
        let merkleRoot = root;
        let listingType = 1;
  

        console.log("total supply before",await nftFacet.totalSupply());
  
        const data = abiCoder.encode(["uint","address[]","bytes32","uint"], [threshold,signers,merkleRoot,listingType]);
        await lockFacet.lock(token.address,amount,["c1"],[1],[0],[["4",data]]);
        const userInfo = (await detailsFacet.viewData(user1.address));
        let simplifiedInfo  = [];
        
        userInfo.forEach(element => {
          let ids = [];
          for(let j = 0 ; j < element.ids.length ; j++)
          ids.push(Number(element.ids[j]))
  
          simplifiedInfo.push({
            amount: Number(element.amount),
            token: element.token,
            operations: (element.operations),
            libTypes: (element.libTypes),
            ids:ids
          });
        });

        // const nftData = await detailsFacet.viewDataById(30);
        // console.log("nftData",nftData);

  
        //console.log(simplifiedInfo)
  
        // const priceData = await detailsFacet.viewPriceData(0);
        // let info;
        // info = ({
        //   token: priceData.token,
        //   priceAtLock: Number(priceData.priceAtLock),
        //   priceAtUnlock: Number(priceData.priceAtUnlock),
        // })
        //console.log(info)
  
      })
  
      it('checks failure case for `unlock` function',async() =>{
        const condition = await detailsFacet.checkUnlock(30);
        expect(condition).to.be.false;
        const data = [0,abiCoder.encode(["uint"], [0])]
        await expect(unlockFacet.unlock(30,user1.address,data)).to.be.revertedWith('Unlock Conditions Mismatch');
      })

      it('sign the lock with non-whitelisted',async() =>{
        const [user3,user4,user5,user6] = await ethers.getSigners()
        const hashedToken = keccak256(user6.address);
        const proof = tree.getHexProof(hashedToken);
        const nftData = await detailsFacet.viewDataById(30);
        const multiSigLockIndex = nftData.libTypes.findIndex((e) => e === 4);
        const id = !!multiSigLockIndex ? nftData.ids[multiSigLockIndex] : 0;
        await expect(multisigSignFacet.signLock(id,proof)).to.be.revertedWith('not whitelisted');
        // const condition = await detailsFacet.checkUnlock(id);
        // expect(condition).to.be.false;
      })
  
      it('sign the lock to match criteria',async() =>{
        const [user3,user4,user5] = await ethers.getSigners()
        let addresses = [user3,user4,user5];
        const nftData = await detailsFacet.viewDataById(30);
        const multiSigLockIndex = nftData.libTypes.findIndex((e) => e === 4);
        const id = !!multiSigLockIndex ? nftData.ids[multiSigLockIndex] : 0;
        for (let i = 0 ; i < addresses.length ; i++) {
          // Compute the Merkle proof for the whitelisted address
          const hashedToken = keccak256(addresses[i].address);
          const proof = tree.getHexProof(hashedToken);
          await multisigSignFacet.connect(addresses[i]).signLock(id,proof);
        }
        const condition = await detailsFacet.checkUnlock(30);
        expect(condition).to.be.true;
      })
  
      // it('should test Lockfacet `unlock` function for price criteria',async() =>{
      //   const condition = await detailsFacet.checkUnlock(2);
      //   expect(condition).to.be.true;
      //   const userBalanceBefore = await token.balanceOf(user1.address);
      //   const contractBalanceBefore = await token.balanceOf(lockFacet.address);
      //   //console.log('userBalanceBefore---->',Number(userBalanceBefore));
      //   //console.log('contractBalanceBefore---->',Number(contractBalanceBefore));
      //   const userInfo = (await detailsFacet.viewData(user1.address));
      //   //console.log(Number(userInfo[0].amount));
      //   const data = [0,abiCoder.encode(["uint"], [0])]
      //   await unlockFacet.unlock(2,user1.address,data);
      //   const userBalanceAfter = await token.balanceOf(user1.address);
      //   const contractBalanceAfter = await token.balanceOf(lockFacet.address);
      //   //console.log('userBalanceAfter---->',Number(userBalanceAfter));
      //   //console.log('contractBalanceAfter---->',Number(contractBalanceAfter));
      //   expect(userBalanceAfter).to.equal(userBalanceBefore.add(userInfo[0].amount));
      //   expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(userInfo[0].amount));
  
      // })
  
    })

  })

  describe('it checks get and set functions of facet',() =>{
    let diamond;
    let token;
    before(async() =>{
      diamond = await ethers.getContractAt('SetAndGetFacet', diamondAddress);
      const Token = await ethers.getContractFactory('Token');
      token = await Token.deploy("TokenA","TokenA",18);
      await token.deployed();
    })

    it(`should change given token feeTokenAddress to deployedtoken `, async () => {
      await diamond.setFeeToken(token.address);
      let feeToken = await diamond.getFeeToken();
      assert.equal(feeToken,token.address);
    })

    it(`should toggle given token feeType value `, async () => {
      let feeTypeOld = await diamond.getFeeType(token.address);
      await diamond.toggleFeeType(token.address);
      let feeTypeNew = await diamond.getFeeType(token.address);
      assert.equal(feeTypeOld,!feeTypeNew);
    })

    it(`should change given token feeTokenAddress to deployedtoken `, async () => {
      await diamond.setFeeToken(token.address);
      let feeToken = await diamond.getFeeToken();
      assert.equal(feeToken,token.address);
    })

    it(`should change given token feeWalletAddress to ${deadAddress} `, async () => {
      await diamond.setFeeWallet(deadAddress);
      let feeWallet = await diamond.getFeeWallet();
      assert.equal(feeWallet,deadAddress);
    })

    it(`should change given token feeAmount to 2 Tokens `, async () => {
      const diamond = await ethers.getContractAt('SetAndGetFacet', diamondAddress);
      await diamond.setFeeAmount("20000000000000000");
      let feeAmount = await diamond.getFeeAmount();
      assert.equal(Number(feeAmount),20000000000000000);
    })

    it(`should change given token feePercent to 2% `, async () => {
      await diamond.setFeePercent("20000000000000000");
      let feePercent = await diamond.getFeePercent();
      assert.equal(Number(feePercent),20000000000000000);
    })

    it(`should toggle given token feeType value `, async () => {
      const diamond = await ethers.getContractAt('SetAndGetFacet', diamondAddress);
      let feeTypeOld = await diamond.getFeeType(token.address);
      await diamond.toggleFeeType(token.address);
      let feeTypeNew = await diamond.getFeeType(token.address);
      assert.equal(feeTypeOld,!feeTypeNew);
    })


  })


  /*********************************************************************************************************/



  
})
