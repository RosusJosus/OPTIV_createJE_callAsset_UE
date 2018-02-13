/**
 * Module Description
 * 
 * Version    Date            Author           Remarks
 * 2.00       23 Jan 2017     amillen
 *
 */

/**
* @NScriptType UserEventScript
* @NApiVersion 2.x
*/
define(['N/record', 'N/task', 'N/log', 'N/format', 'N/search', 'N/runtime'], function (record, task, log, format, search, runtime) {
  	function afterSubmit(context){

    	log.debug('context ARS', context.type);
    	if (context.type == context.UserEventType.CREATE) {
     		var contextObj = context.newRecord;
      		var rec_id = contextObj.id;
      		var recType = contextObj.type;

      		var recObjType = checkRecType(recType);
      		//log.debug('rec obj type', recObjType);

			var regexSOITM = new RegExp("^Sales Order", "i");
			var regexVrtrnITM = new RegExp("^Vendor Return Authorization", "i");
			var regexPORcpt = new RegExp("^Purchase Order", "i");
			var regexRtrnRcpt = new RegExp("^Return Authorization", "i");
					
			var o_rec = record.load({type: recObjType, id: rec_id});//10 units
			var ar_accounts = {};
			var ap_accounts = {};

		
			//var revLine, costLine, grossProfit, gpPct;
			//var hasValidItems = false;
			var hasNonASP = false;
			var crtdFromText = o_rec.getText('createdfrom');
			//log.debug('created from text', crtdFromText);
		
			try{
				if(recType == 'itemfulfillment' && regexSOITM.test(crtdFromText)){//if Item Fulfillment from a Sales Order
					ar_accounts['debit'] = 601; //Received Goods not Invoiced - 601 Prod, 601 in SB1
					ar_accounts['credit'] = 54; //Revenue 
					ap_accounts['debit'] = 130; //Cost of Sales (COGS-Cost of Goods Sold)
					ap_accounts['credit'] = 603; //Received Goods Not Billed - 603 Prod, 576 in SB1
					var soID = o_rec.getValue('createdfrom');
					if(isNotNull(soID)){
						var o_so = record.load({type: record.Type.SALES_ORDER, id: soID });//10 units
					}
					var migrationAccural = o_so.getValue('custbodyaccrual_migrate_order');
					//log.debug('Is Legacy Transaction by Date', isLegacy_date(format.parse({value: o_so.getValue('trandate'), type: format.Type.DATE})));
					if(true)//!isLegacy_date(nlapiStringToDate(o_so.getValue('trandate'))) || migrationAccural == 'T') //if this is an Item Fulfillment that did not come from a legacy SO, then create journal
					{
						//var aa_ARclassAmts = {};
						var a_ARLineObj = [];
						//var aa_APclassAmts = {};
						var a_APLineObj = [];
						var poID = 0;
						var po_SubCurr;
						var vendorID;
						//var a_class = [];
						var itemType = o_so.getSublistValue('item', 'itemtype', 0);
						//var hybridOrder = o_rec.getValue('custbody_generate_accruals');
						//if(hybridOrder != 'T' && itemType != 'NonInvtPart')return; //stops services orders from following this process. This is all built assuming NonInventory
						var so_SubCurr = search.lookupFields({ type: search.Type.SALES_ORDER, id: soID,  columns: ['subsidiary', 'currency'] });
						//loop through lines to get info needed
						//where Item on ITM  and SO match using this field: custcol_so_line_id or can use SO Line ID (custcol_so_line_id)
						var itmLineCt = o_rec.getLineCount('item');
						var soLineCt = o_so.getLineCount('item');
						var qty, revLine, costLine, grossProfit, gpPct;
						for(var itm_i = 0; itm_i < itmLineCt; itm_i ++){//for every item on fulfillment, find corresponding Item on Sales Order
							var itm_sfLineID = o_rec.getSublistValue('item', 'custcol_so_line_id', itm_i);
							for(var so_i = 0; so_i < soLineCt; so_i++){
								if(itm_sfLineID == o_so.getSublistValue('item', 'custcol_so_line_id', so_i)){//if the fulfillment line matches the SO line
									var classID = o_so.getSublistValue('item', 'class', so_i);
									itemType = o_so.getSublistValue('item', 'itemtype', so_i);
									if(isNull(poID)){
										poID = o_so.getSublistValue('item', 'createdpo', so_i);
										log.debug('po id', poID);
									}
									if(isNull(po_SubCurr)){
										//po_SubCurr = isNotNull(poID)?nlapiLookupField('purchaseorder', poID, ['subsidiary', 'currency']):null;
										po_SubCurr = {};
										po_SubCurr['subsidiary'] = so_SubCurr.subsidiary[0].value;
										log.debug('po sub curr vals', currencyTxtToID(o_so.getSublistValue('item', 'pocurrency', so_i)) + ' curr text ' + o_so.getSublistValue('item', 'pocurrency', so_i));
										po_SubCurr['currency'] = currencyTxtToID(o_so.getSublistValue('item', 'pocurrency', so_i));
									}
									if(isNull(vendorID)){
										//vendorID = isNotNull(poID)?nlapiLookupField('purchaseorder', poID, 'entity'):null;
										vendorID = o_so.getSublistValue('item', 'povendor', so_i);
										log.debug('vendor id if null', vendorID);

									}
		
									var correctAccts = true;
									if(itemType == 'NonInvtPart'){
										var accntObj =  search.lookupFields({type: search.Type.NON_INVENTORY_ITEM, id: o_so.getSublistValue('item', 'item', so_i), columns: ['incomeaccount']});
										log.debug('income account search look up object return', accntObj.incomeaccount[0].value);
										var incomeAccount = accntObj.incomeaccount[0].value;
										if(incomeAccount == '601'){//Received Goods not Invoiced - 601 Prod, 575 in SB1
											correctAccts = true;
										}
										else{
											correctAccts = false;
										}
									}
									//log.debug('isASP', 'isASP: '+isASP(classID));
									if(!isASP(classID) && itemType == 'NonInvtPart' && correctAccts){
										hasNonASP = true;
										qty = Number(o_rec.getSublistValue('item', 'quantity', itm_i));
										revLine = Number(o_so.getSublistValue('item', 'rate', so_i)) * qty;
										costLine = Number(o_so.getSublistValue('item', 'custcolunitcost', so_i)) * qty;
										grossProfit = revLine - costLine;
										gpPct = (revLine!=0)?((grossProfit/revLine)*100):0;
										log.debug("AR vals", revLine + ' ' + costLine + ' ' + grossProfit);
										a_ARLineObj.push({
											item: o_rec.getSublistValue('item', 'item', itm_i),
											amount: revLine,
											cost: costLine,
											qty: qty,
											classID: classID,
											lineID: itm_sfLineID,
											grossProfit: grossProfit,
											gpPct:gpPct
										});
										
										a_APLineObj.push({
											item: o_rec.getSublistValue('item', 'item', itm_i),
											amount: (Number(o_so.getSublistValue('item', 'porate', so_i)) * Number(o_rec.getSublistValue('item', 'quantity', itm_i))),
											qty: qty,
											classID: classID,
											lineID: itm_sfLineID
										});
									}																			
								}
							}
						}//retreived data for all ITM lines
						
						//get Rep Dept, Location, and Contribution %
						var rep1Fields = (isNotNull(o_so.getValue('custbody_sales_rep_1')))?search.lookupFields({type: search.Type.EMPLOYEE, id: o_so.getValue('custbody_sales_rep_1'), columns: ['custentity_inc_loc', 'custentity_canada_loc', 'custentity_fed_loc']}):null;//10 units
						var rep2Fields = (isNotNull(o_so.getValue('custbody_sales_rep_2')))?search.lookupFields({type: search.Type.EMPLOYEE, id: o_so.getValue('custbody_sales_rep_2'), columns: ['custentity_inc_loc', 'custentity_canada_loc', 'custentity_fed_loc']}):null;//10 units
						var rep3Fields = (isNotNull(o_so.getValue('custbody_sales_rep_3')))?search.lookupFields({type: search.Type.EMPLOYEE, id: o_so.getValue('custbody_sales_rep_3'), columns: ['custentity_inc_loc', 'custentity_canada_loc', 'custentity_fed_loc']}):null;//10 units
						
						//log.debug('rep 1 search look ups', rep1Fields.custentity_inc_loc[0].value);


						var o_rep1 = (rep1Fields!=null)?{internalId: o_so.getValue('custbody_sales_rep_1'),
								department: o_so.getValue('custbody_sales_rep_1_department'),
								inc_location: rep1Fields.custentity_inc_loc[0].value, 
								canada_location: rep1Fields.custentity_canada_loc[0].value,
								fed_location: rep1Fields.custentity_fed_loc[0].value,
								contribution: o_so.getValue('custbody_sales_rep_1_percent')}:null;
						var o_rep2 = (rep2Fields!=null)?{internalId: o_so.getValue('custbody_sales_rep_2'),
								department: o_so.getValue('custbody_sales_rep_2_department'),
								inc_location: rep2Fields.custentity_inc_loc[0].value, 
								canada_location: rep2Fields.custentity_canada_loc[0].value,
								fed_location: rep2Fields.custentity_fed_loc[0].value,
								contribution: o_so.getValue('custbody_sales_rep_2_percent')}:null;
						var o_rep3 = (rep3Fields!=null)?{internalId: o_so.getValue('custbody_sales_rep_3'),
								department: o_so.getValue('custbody_sales_rep_3_department'),
								inc_location: rep3Fields.custentity_inc_loc[0].value, 
								canada_location: rep3Fields.custentity_canada_loc[0].value,
								fed_location: rep3Fields.custentity_fed_loc[0].value,
								contribution: o_so.getValue('custbody_sales_rep_3_percent')}:null;
						//var vendorID = isNotNull(poID)?nlapiLookupField('purchaseorder', poID, 'entity'):null;
						if(hasNonASP){
							log.debug('Posting Period', 'Date: '+o_rec.getValue('trandate')+ ' Posting Period: '+ o_rec.getValue('postingperiod'));
							//var arJE = createJE_old(o_rec.getValue('trandate'), o_rec.getValue('postingperiod'), so_SubCurr,o_rep1, o_rep2, o_rep3, aa_ARclassAmts, a_class, ar_accounts, soID, poID, o_so.getValue('entity'), true, false);
							//var apJE = createJE_old(o_rec.getValue('trandate'), o_rec.getValue('postingperiod'), po_SubCurr,o_rep1, o_rep2, o_rep3, aa_APclassAmts, a_class, ap_accounts, soID, poID, vendorID, false, false);	
							
							var arJE = createJE(o_rec.getValue('trandate'), o_rec.getValue('postingperiod'), so_SubCurr,o_rep1, o_rep2, o_rep3, a_ARLineObj, ar_accounts, soID, poID, o_so.getValue('entity'), true, false, context);
							
							log.debug('ap line obj',a_APLineObj + ', ' + ap_accounts)
							var apJE = (isNotNull(poID)||o_rec.getValue('custbody_fulfillment_type') == 12)? //if poID is not null or this is credit rebill, create AP JE. 
								createJE(o_rec.getValue('trandate'), o_rec.getValue('postingperiod'), po_SubCurr,o_rep1, o_rep2, o_rep3, a_APLineObj, ap_accounts, soID, poID, vendorID, false, false, context):
									null;
							
							o_rec.setValue('custbody_ar_je', arJE);
							o_rec.setValue('custbody_ap_je', apJE);
							var oId = o_rec.save();
						}								
					}
				}
				else if(recType == 'itemfulfillment' && regexVrtrnITM.test(crtdFromText)){//else if fulfillment from VRTRN //reversal of AP side only
					ap_accounts['credit'] = 130; //Cost of Sales (COGS-Cost of Goods Sold)
					ap_accounts['debit'] = 603; //Received Goods Not Billed - 603 in Prod, 576 in Dev
					var vrtrnID = o_rec.getValue('createdfrom');
					var o_vrtrn = record.load({type: record.Type.VENDOR_RETURN_AUTHORIZATION, id: vrtrnID });//10 units
					//log.debug('Is Legacy Transaction by Date', isLegacy_date(nlapiStringToDate(o_vrtrn.getValue('trandate'))));
					if(true)//!isLegacy_date(nlapiStringToDate(o_vrtrn.getValue('trandate')))) //if this is an Item Fulfillment that did not come from a legacy SO, then create journal
					{
						//var aa_APclassAmts = {};
						//var a_class = [];
						var a_APLineObj = [];
	
						var itemType = o_vrtrn.getSublistValue('item', 'itemtype', 0);
						//var hybridOrder = o_rec.getValue('custbody_generate_accruals');
						log.debug('Item Type', 'Item Type: '+itemType);
						//if(hybridOrder != 'T' && itemType != 'NonInvtPart')return; //stops services orders from following this process. This is all built assuming NonInventory
						
						//loop through lines to get info needed
						//where Item on ITM  and SO match using this field: custcol_so_line_id or can use SO Line ID (custcol_so_line_id)
						var itmLineCt = o_rec.getLineCount('item');
						var vrtrnLineCt = o_vrtrn.getLineCount('item');
						var qty;//, revLine, costLine, grossProfit, gpPct;
	
						for(var itm_i = 0; itm_i < itmLineCt; itm_i ++){//for every item on fulfillment, find corresponding Item on Sales Order
							var itm_sfLineID = o_rec.getSublistValue('item', 'custcol_so_line_id', itm_i);
							for(var vrtrn_i = 0; vrtrn_i < vrtrnLineCt; vrtrn_i++){
								if(itm_sfLineID == o_vrtrn.getSublistValue('item', 'custcol_so_line_id', vrtrn_i)){//if the fulfillment line matches the SO line
									itemType = o_vrtrn.getSublistValue('item', 'itemtype', vrtrn_i);
									var classID = o_vrtrn.getSublistValue('item', 'class', vrtrn_i);
									log.debug('isASP', 'isASP: '+isASP(classID));
									var correctAccts = true;
									if(itemType == 'NonInvtPart'){
										var accntObj =  search.lookupFields({type: search.Type.NON_INVENTORY_ITEM, id: o_vrtrn.getSublistValue('item', 'item', vrtrn_i), columns: ['incomeaccount']});
										var incomeAccount = accntObj.incomeaccount[0].value;
										log.debug('income account line 215', incomeAccount);

										if(incomeAccount == '601'){//Received Goods not Invoiced - 601 Prod, 575 in SB1
											correctAccts = true;
										}
										else{
											correctAccts = false;
										}
									}
									if(!isASP(classID) && itemType == 'NonInvtPart' && correctAccts){
										hasNonASP = true;
										qty = Number(o_rec.getSublistValue('item', 'quantity', itm_i));
		
										a_APLineObj.push({
											item: o_rec.getSublistValue('item', 'item', itm_i),
											amount: (Number(o_vrtrn.getSublistValue('item', 'rate', vrtrn_i)) * Number(o_rec.getSublistValue('item', 'quantity', itm_i))),
											qty: qty,
											classID: classID,
											lineID: itm_sfLineID
										});
									}																			
								}
							}
						}//retreived data for all ITM lines
			
						var vrtrn_SubCurr = search.lookupFields({type: search.Type.VENDOR_RETURN_AUTHORIZATION, id: vrtrnID, columns : ['subsidiary', 'currency']});
						//get Rep Dept, Location, and Contribution %
						var rep1Fields = (isNotNull(o_vrtrn.getValue('custbody_sales_rep_1')))?search.lookupFields({type: search.Type.EMPLOYEE, id: o_vrtrn.getValue('custbody_sales_rep_1'), columns: ['custentity_inc_loc', 'custentity_canada_loc', 'custentity_fed_loc']}):null;//10 units
						var rep2Fields = (isNotNull(o_vrtrn.getValue('custbody_sales_rep_2')))?search.lookupFields({type: search.Type.EMPLOYEE, id: o_vrtrn.getValue('custbody_sales_rep_2'), columns: ['custentity_inc_loc', 'custentity_canada_loc', 'custentity_fed_loc']}):null;//10 units
						var rep3Fields = (isNotNull(o_vrtrn.getValue('custbody_sales_rep_3')))?search.lookupFields({type: search.Type.EMPLOYEE, id: o_vrtrn.getValue('custbody_sales_rep_3'), columns: ['custentity_inc_loc', 'custentity_canada_loc', 'custentity_fed_loc']}):null;//10 units
						
						log.debug('rep fields 246', rep1Fields.custentity_inc_loc[0].value);
						var o_rep1 = (rep1Fields!=null)?{internalId: o_vrtrn.getValue('custbody_sales_rep_1'),
							department: o_vrtrn.getValue('custbody_sales_rep_1_department'),
							inc_location: rep1Fields.custentity_inc_loc[0].value, 
							canada_location: rep1Fields.custentity_canada_loc[0].value,
							fed_location: rep1Fields.custentity_fed_loc[0].value,
							contribution: o_vrtrn.getValue('custbody_sales_rep_1_percent')}:null;
						var o_rep2 = (rep2Fields!=null)?{internalId: o_vrtrn.getValue('custbody_sales_rep_2'),
							department: o_vrtrn.getValue('custbody_sales_rep_2_department'),
							inc_location: rep2Fields.custentity_inc_loc[0].value, 
							canada_location: rep2Fields.custentity_canada_loc[0].value,
							fed_location: rep2Fields.custentity_fed_loc[0].value,
							contribution: o_vrtrn.getValue('custbody_sales_rep_2_percent')}:null;
						var o_rep3 = (rep3Fields!=null)?{internalId: o_vrtrn.getValue('custbody_sales_rep_3'),
							department: o_vrtrn.getValue('custbody_sales_rep_3_department'),
							inc_location: rep3Fields.custentity_inc_loc[0].value, 
							canada_location: rep3Fields.custentity_canada_loc[0].value,
							fed_location: rep3Fields.custentity_fed_loc[0].value,
							contribution: o_vrtrn.getValue('custbody_sales_rep_3_percent')}:null;
						var vendorObj = search.lookupFields({type: search.Type.VENDOR_RETURN_AUTHORIZATION, id: vrtrnID, columns: ['entity']});
						var vendorID = vendorObj.entity[0].value;
						if(hasNonASP){
							var apJE = createJE(o_rec.getValue('trandate'),o_rec.getValue('postingperiod'),vrtrn_SubCurr,o_rep1, o_rep2, o_rep3, a_APLineObj, ap_accounts, null, vrtrnID, vendorID, false, true, context);	
							
							o_rec.setValue('custbody_ap_je', apJE);
							var oID = o_rec.save();
						}
					}
				}
				else if(recType == 'itemreceipt' && regexPORcpt.test(crtdFromText)){//else if Receipt from Purchase Order //hit AP side only
					ap_accounts['debit'] = 130; //Cost of Sales (COGS-Cost of Goods Sold)
					ap_accounts['credit'] = 603; //Received Goods Not Billed - 603 in Prod, 576 in Dev
					
					var poID = o_rec.getValue('createdfrom');
					var o_po = record.load({type: record.Type.PURCHASE_ORDER, id: poID });//10 units
					var migrationAccural = o_po.getValue('custbodyaccrual_migrate_order');
		
					log.debug('PO From SO', 'PO From SO: ' + regexSOITM.test(o_po.getText('createdfrom')));
					if(regexSOITM.test(o_po.getFieldText('createdfrom')))return;//only want to act if not created from sales order
					
					if(true)//!isLegacy_date(nlapiStringToDate(o_po.getValue('trandate'))) || migrationAccural =='T') //if this is an Item Receipt that did not come from a legacy SO, then create journal
					{
						//var aa_APclassAmts = {};
						//var a_class = [];
						var a_APLineObj = [];
		
						var itemType = o_po.getSublistValue('item', 'itemtype', 0);
						//var hybridOrder = o_rec.getValue('custbody_generate_accruals');
						log.debug('Item Type', 'Item Type: '+itemType);
						//if(hybridOrder != 'T' && itemType != 'NonInvtPart')return; //stops services orders from following this process. This is all built assuming NonInventory
						
						//loop through lines to get info needed
						//where Item on ITM  and SO match using this field: custcol_so_line_id 
						var itmLineCt = o_rec.getLineCount('item');
						var poLineCt = o_po.getLineCount('item');
						var qty, revLine, costLine, grossProfit, gpPct;
		
						for(var itm_i = 0; itm_i < itmLineCt; itm_i ++){//for every item on fulfillment, find corresponding Item on Sales Order
							var itm_sfLineID = o_rec.getSublistValue('item', 'custcol_so_line_id', itm_i);
							for(var po_i = 0; po_i < poLineCt; po_i++){
								if(itm_sfLineID == o_po.getSublistValue('item', 'custcol_so_line_id', po_i)){//if the fulfillment line matches the SO line
									var classID = o_po.getSublistValue('item', 'class', po_i);
									itemType = o_po.getSublistValue('item', 'itemtype', po_i);					
									log.debug('isASP', 'isASP: '+isASP(classID));
									var correctAccts = true;
									if(itemType == 'NonInvtPart'){
										var accntObj =  search.lookupFields({type: search.Type.NON_INVENTORY_ITEM, id: o_po.getSublistValue('item', 'item', po_i), columns: ['incomeaccount']});
										var incomeAccount = accntObj.incomeaccount[0].value;
										log.debug('income account on item receipt', incomeAccount);
										if(incomeAccount['incomeaccount'] == '601'){//Received Goods not Invoiced - 601 Prod, 575 in SB1
											correctAccts = true;
										}
										else{
											correctAccts = false;
										}
									}
									if(!isASP(classID) && itemType == 'NonInvtPart' && correctAccts){
										hasNonASP = true;
										qty = Number(o_rec.getSublistValue('item', 'quantity', itm_i));
										a_APLineObj.push({
											item: o_rec.getSublistValue('item', 'item', itm_i),
											amount: (Number(o_po.getSublistValue('item', 'rate', po_i)) * qty),
											qty: qty,
											classID: classID,
											lineID: itm_sfLineID
										});
									}																			
								}
							}						
						}//retreived data for all ITM lines
						var po_SubCurr = search.lookupFields({type: search.Type.PURCHASE_ORDER, id: poID, columns: ['subsidiary', 'currency']});
						//get Rep Dept, Location, and Contribution %
						var rep1Fields = (isNotNull(o_po.getValue('custbody_sales_rep_1')))?search.lookupFields({type: search.Type.EMPLOYEE, id: o_po.getValue('custbody_sales_rep_1'), columns: ['custentity_inc_loc', 'custentity_canada_loc', 'custentity_fed_loc']}):null;//10 units
						var rep2Fields = (isNotNull(o_po.getValue('custbody_sales_rep_2')))?search.lookupFields({type: search.Type.EMPLOYEE, id: o_po.getValue('custbody_sales_rep_2'), columns: ['custentity_inc_loc', 'custentity_canada_loc', 'custentity_fed_loc']}):null;//10 units
						var rep3Fields = (isNotNull(o_po.getValue('custbody_sales_rep_3')))?search.lookupFields({type: search.Type.EMPLOYEE, id: o_po.getValue('custbody_sales_rep_3'), columns: ['custentity_inc_loc', 'custentity_canada_loc', 'custentity_fed_loc']}):null;//10 units
						
						var o_rep1 = (rep1Fields!=null)?{internalId: o_po.getValue('custbody_sales_rep_1'),
							department: o_po.getValue('custbody_sales_rep_1_department'),
							inc_location: rep1Fields.custentity_inc_loc[0].value, 
							canada_location: rep1Fields.custentity_canada_loc[0].value,
							fed_location: rep1Fields.custentity_fed_loc[0].value,
							contribution: o_po.getValue('custbody_sales_rep_1_percent')}:null;
						var o_rep2 = (rep2Fields!=null)?{internalId: o_po.getValue('custbody_sales_rep_2'),
							department: o_po.getValue('custbody_sales_rep_2_department'),
							inc_location: rep2Fields.custentity_inc_loc[0].value, 
							canada_location: rep2Fields.custentity_canada_loc[0].value,
							fed_location: rep2Fields.custentity_fed_loc[0].value,
							contribution: o_po.getValue('custbody_sales_rep_2_percent')}:null;
						var o_rep3 = (rep3Fields!=null)?{internalId: o_po.getValue('custbody_sales_rep_3'),
							department: o_po.getValue('custbody_sales_rep_3_department'),
							inc_location: rep3Fields.custentity_inc_loc[0].value, 
							canada_location: rep3Fields.custentity_canada_loc[0].value,
							fed_location: rep3Fields.custentity_fed_loc[0].value,
							contribution: o_po.getValue('custbody_sales_rep_3_percent')}:null;
						var vendorID = o_po.getValue('entity');
						if(hasNonASP){
							var apJE = createJE(o_rec.getValue('trandate'),o_rec.getValue('postingperiod'), po_SubCurr,o_rep1, o_rep2, o_rep3, a_APLineObj, ap_accounts, null, poID, vendorID, false, false, context);	
							
							o_rec.setValue('custbody_ap_je', apJE);
							var oID = o_rec.save();
						}
					}				
				}
				else if(recType == 'itemreceipt' && regexRtrnRcpt.test(crtdFromText)){//else if Receipt from RTRN //reversal of AR Side only
					ar_accounts['credit'] = 601; //Received Goods not Invoiced - 601 in Prod, 575 in Dev
					ar_accounts['debit'] = 54; //Revenue 
					var rtrnID = o_rec.getValue('createdfrom');
					var o_rtrn = record.load({type: record.Type.RETURN_AUTHORIZATION, id: rtrnID });//10 units
					//nlapiLogExecution('DEBUG', 'Is Legacy Transaction by Date', isLegacy_date(nlapiStringToDate(o_rtrn.getValue('trandate'))));
					if(true)//!isLegacy_date(nlapiStringToDate(o_rtrn.getValue('trandate')))) //if this is an Item Fulfillment that did not come from a legacy SO, then create journal
					{
						//var aa_ARclassAmts = {};
						//var a_class = [];
						var a_ARLineObj = [];
		
						var itemType = o_rtrn.getSublistValue('item', 'itemtype', 0);
						//var hybridOrder = o_rec.getValue('custbody_generate_accruals');
						log.debug('Item Type', 'Item Type: '+itemType);
						//if(hybridOrder != 'T' && itemType != 'NonInvtPart')return; //stops services orders from following this process. This is all built assuming NonInventory
						
						//loop through lines to get info needed
						//where Item on ITM  and SO match using this field: custcol_so_line_id or can use SO Line ID (custcol_so_line_id)
						var recLineCt = o_rec.getLineCount('item');
						var rtrnLineCt = o_rtrn.getLineCount('item');
						for(var itm_i = 0; itm_i < recLineCt; itm_i ++){//for every item on fulfillment, find corresponding Item on Sales Order
							var itm_sfLineID = o_rec.getSublistValue('item', 'custcol_so_line_id', itm_i);
							for(var rtrn_i = 0; rtrn_i < rtrnLineCt; rtrn_i++){
								if(itm_sfLineID == o_rtrn.getSublistValue('item', 'custcol_so_line_id', rtrn_i)){//if the fulfillment line matches the SO line
									itemType = o_rtrn.getSublistValue('item', 'itemtype', rtrn_i);
									var classID = o_rtrn.getSublistValue('item', 'class', rtrn_i);
									log.debug('isASP', 'isASP: '+isASP(classID));
									var correctAccts = true;
									if(itemType == 'NonInvtPart'){
										var accountObj =  search.lookupFields({type: search.Type.NON_INVENTORY_ITEM, id: o_rtrn.getSublistValue('item', 'item', rtrn_i), columns: ['incomeaccount']});
										var incomeAccount = accountObj.incomeaccount[0].value;
										log.debug('income account line 401', incomeAccount);
										if(incomeAccount == '601'){//Received Goods not Invoiced - 601 Prod, 575 in SB1
											correctAccts = true;
										}
										else{
											correctAccts = false;
										}
									}
									if(!isASP(classID) && itemType == 'NonInvtPart' && correctAccts){
										hasNonASP = true;
										qty = Number(o_rec.getSublistValue('item', 'quantity', itm_i));
										revLine = Number(o_rtrn.getSublistValue('item', 'rate', rtrn_i)) * qty;
										costLine = Number(o_rtrn.getSublistValue('item', 'custcolunitcost', rtrn_i)) * qty;
										grossProfit = revLine - costLine;
										gpPct = (revLine!=0)?to2Decimal(grossProfit/revLine):0;
										a_ARLineObj.push({
											item: o_rec.getSublistValue('item', 'item', itm_i),
											amount: revLine,
											cost: costLine,
											qty: qty,
											classID: classID,
											lineID: itm_sfLineID,
											grossProfit: grossProfit,
											gpPct:gpPct
										});
									}																			
								}
							}
						}//retreived data for all RECT lines
						var rtrn_SubCurr = search.lookupFields({type: search.Type.RETURN_AUTHORIZATION, id: rtrnID, columns: ['subsidiary', 'currency']});
						//get Rep Dept, Location, and Contribution %
						var rep1Fields = (isNotNull(o_rtrn.getValue('custbody_sales_rep_1')))?search.lookupFields({type: search.Type.EMPLOYEE, id: o_rtrn.getValue('custbody_sales_rep_1'), columns: ['custentity_inc_loc', 'custentity_canada_loc', 'custentity_fed_loc']}):null;//10 units
						var rep2Fields = (isNotNull(o_rtrn.getValue('custbody_sales_rep_2')))?search.lookupFields({type: search.Type.EMPLOYEE, id: o_rtrn.getValue('custbody_sales_rep_2'), columns: ['custentity_inc_loc', 'custentity_canada_loc', 'custentity_fed_loc']}):null;//10 units
						var rep3Fields = (isNotNull(o_rtrn.getValue('custbody_sales_rep_3')))?search.lookupFields({type: search.Type.EMPLOYEE, id:  o_rtrn.getValue('custbody_sales_rep_3'), columns: ['custentity_inc_loc', 'custentity_canada_loc', 'custentity_fed_loc']}):null;//10 units
						
						var o_rep1 = (rep1Fields!=null)?{internalId: o_rtrn.getValue('custbody_sales_rep_1'),
								department: o_rtrn.getValue('custbody_sales_rep_1_department'),
								inc_location: rep1Fields.custentity_inc_loc[0].value, 
								canada_location: rep1Fields.custentity_canada_loc[0].value,
								fed_location: rep1Fields.custentity_fed_loc[0].value,
								contribution: o_rtrn.getValue('custbody_sales_rep_1_percent')}:null;
						var o_rep2 = (rep2Fields!=null)?{internalId: o_rtrn.getValue('custbody_sales_rep_2'),
								department: o_rtrn.getValue('custbody_sales_rep_2_department'),
								inc_location: rep2Fields.custentity_inc_loc[0].value, 
								canada_location: rep2Fields.custentity_canada_loc[0].value,
								fed_location: rep2Fields.custentity_fed_loc[0].value,
								contribution: o_rtrn.getValue('custbody_sales_rep_2_percent')}:null;
						var o_rep3 = (rep3Fields!=null)?{internalId: o_rtrn.getValue('custbody_sales_rep_3'),
								department: o_rtrn.getValue('custbody_sales_rep_3_department'),
								inc_location: rep3Fields.custentity_inc_loc[0].value, 
								canada_location: rep3Fields.custentity_canada_loc[0].value,
								fed_location: rep3Fields.custentity_fed_loc[0].value,
								contribution: o_rtrn.getValue('custbody_sales_rep_3_percent')}:null;
						if(hasNonASP){
							var arJE = createJE(o_rec.getValue('trandate'), o_rec.getValue('postingperiod'),rtrn_SubCurr,o_rep1, o_rep2, o_rep3, a_ARLineObj, ar_accounts, rtrnID, null, o_rtrn.getValue('entity'), true, true, context);					
							
							
							o_rec.setValue('custbody_ar_je', arJE);
							var oID = o_rec.save();
						
						}								
					}
				}

				var contextObj = context.newRecord;
	      		var recID = contextObj.id;
	      		var recType = contextObj.type;
	     		var type = context.type;
	     		

	     		var scriptTask = task.create({
	                 taskType: task.TaskType.SCHEDULED_SCRIPT,
	                 scriptId: 'customscript_create_asset_ss',
	                 deploymentId: null,
	                 params: {custscript_asset_rec_type_2: recType, custscript_asset_rec_id_2: recID, custscript_asset_action_type_2: type}
	           	});
	          	var scriptTaskId = scriptTask.submit();
	          	log.debug('script task id', scriptTaskId);
			}
			catch(err){
              log.debug('error line 492', err.name + ', '+ err.message + ', ' + err.stack);
				o_rec.setValue('custbody_gl_impact_error', getErrorMsg(err));
				o_rec.save();
			}
		}
		else if (context.type == context.UserEventType.DELETE){//delete all Journals attached to this Record
			try{
				var contextObj = context.newRecord;
      			var rec_id = contextObj.id;
      			var recType = contextObj.type;

      			var recObjType = checkRecType(recType);
      			log.debug('rec obj type', recObjType);

				var o_oldRec = context.oldRecord;

				log.debug('Deletion IDs', 'Old ID:'+o_oldRec.id + " nlapiGetRecordId(): "+ context.newRecord.id);

				//var currRecID = context.newRecord.id;
	  
				var apTxnid = o_oldRec.getValue('custbody_ap_je');
				var arTxnid = o_oldRec.getValue('custbody_ar_je');

				log.debug('ar ap id', apTxnid +' ' + arTxnid);
				if(isNotNull(apTxnid)){
					record.delete({type: record.Type.JOURNAL_ENTRY, id: apTxnid});
				}
				if(isNotNull(arTxnid)){
					record.delete({type: record.Type.JOURNAL_ENTRY, id: arTxnid});
				}
	      
		      	var oldItmCt = o_oldRec.getLineCount('item');

		      	log.debug('line count for deleting assets', oldItmCt);

			    for(var i = 0; i < oldItmCt; i++){

			        var assetID = o_oldRec.getSublistValue('item', 'custcol_acctg_line_asset', i);
			        log.debug('asset id for loop', assetID);

			        if(isNotNull(assetID)){           
			          log.debug('deleting asset inside for loop before submit');
			          record.delete({type: 'customrecord_acctg_rpt_line', id: assetID});
			        }
			    }
			}
			catch(err){

				var contextObj = context.newRecord;
      			var rec_id = contextObj.id;
      			var recType = contextObj.type;

      			var recObjType = checkRecType(recType);
      			log.debug('rec obj type', recObjType);

				var o_rec = record.load({type: recObjType, id: rec_id});//10 units

				o_rec.setValue('custbody_gl_impact_error', getErrorMsg(err));
				o_rec.save();
			}
		}
		else if (context.type == context.UserEventType.EDIT) {//on edit, update corresponding Journal	
	 		var contextObj = context.newRecord;
	  		var rec_id = contextObj.id;
	  		var recType = contextObj.type;
	  		var type = context.type;

	  		var recObjType = checkRecType(recType);
					
		
			try{
				var execContext = runtime.executionContext;
				log.debug('execution inside edit', execContext);
				if(execContext == 'SCHEDULED'){
					return;
				}

				log.debug('inside edit line 582', recType + ' '+ rec_id + ' ' + type);
				var scriptTask = task.create({
	                 taskType: task.TaskType.SCHEDULED_SCRIPT,
	                 scriptId: 'customscript_create_asset_ss',
	                 deploymentId: null,
	                 params: {custscript_asset_rec_type: recType, custscript_asset_rec_id: rec_id, custscript_asset_action_type: type}
	           	});
	          	var scriptTaskId = scriptTask.submit();
	          	log.debug('script task id', scriptTaskId);		


				var o_rec = record.load({type: recObjType, id: rec_id});
				//Only update if date or posting period change
				var old_rec =  context.oldRecord;
				//var new_rec =  context.newRecord;
				if(old_rec.getValue('trandate') == o_rec.getValue('trandate')
					&& old_rec.getValue('postingperiod') == o_rec.getValue('postingperiod'))return;
				
				var arJEID = o_rec.getValue('custbody_ar_je');
				var apJEID = o_rec.getValue('custbody_ap_je');
				
				var recDate = o_rec.getValue('trandate');
				var recPeriod = o_rec.getValue('postingperiod');
				
				if(isNotNull(arJEID)){			
					updateJE(arJEID,recDate, recPeriod);
				}
						
				if(isNotNull(apJEID)){
					updateJE(apJEID,recDate, recPeriod);
				}
				o_rec.setValue('custbody_item_fulfill_date_change', false);
				o_rec.save();
			}
			catch(err){
				var o_rec = record.load({type: recObjType, id: rec_id});
				o_rec.setValue('custbody_gl_impact_error', getErrorMsg(err));
				o_rec.save();
			}
		}
	}
	return {
		afterSubmit: afterSubmit
	}

	/**
	 * Create Journal Entry for Accural of revenue and Costs
	 * Break down Revenue and COGS amounts by all reps, but take RGNI/RGNB with 100% and Rep 1 Department/Location
	 * *If isARJE = true (AR Journal), then break out the credit (Revenue) by Rep, but keep debit (RGNI) at 100% and rep 1 info 
	 * *If isARJE = false (AP journal), then break out debit (COGS) by Rep, but keep credit (RGNB) at 100% and rep 1 info
	 * 
	 * Version 2.0 = Creates 1 Journal Entry per line item on Record from creation (fulfillment/receipt)
	 * Max #
	 * 
	 * @param date
	 * @param aa_subCurr
	 * @param o_rep1
	 * @param o_rep2
	 * @param o_rep3
	 * @param aa_classAmts
	 * @param a_class
	 * @param aa_accounts
	 * @param soID
	 * @param poID
	 * @param entity
	 * @param isARJE
	 * @returns id of newly created Journal Entry
	 */
	function createJE(date, postingPeriod, aa_subCurr, o_rep1, o_rep2,o_rep3, a_LineObj, aa_accounts, soID, poID, entity, isARJE, isRTRN, context){
	//create journal record

		var o_je = record.create({type: record.Type.JOURNAL_ENTRY, isDynamic: true});
		o_je.setValue('trandate', date);//set date
		if(isARJE){
			o_je.setValue('subsidiary', aa_subCurr.subsidiary[0].value);//set subsidiary from SO
			o_je.setValue('currency', aa_subCurr.currency[0].value);//set currency from SO
			//log.debug('create JE object vals', aa_subCurr.subsidiary[0].value);
			var subsidiaryID = aa_subCurr.subsidiary[0].value;
		}
		else if(isARJE == false){
			o_je.setValue('subsidiary', aa_subCurr.subsidiary);//set subsidiary from SO
			o_je.setValue('currency', aa_subCurr.currency);//set currency from SO
			//log.debug('create JE object vals', aa_subCurr.subsidiary[0].value);
			var subsidiaryID = aa_subCurr.subsidiary;
		}
		var rep1_location= '';
		var rep2_location= '';
		var rep3_location= '';
		var hasRep2 =  false, hasRep3 = false;
		
		if(soID!=null)o_je.setValue('custbody_ar_transaction', soID);//set custbody_ar_transaction from SO #
		if(poID!=null)o_je.setValue('custbody_ap_transaction', poID);//set custbody_ap_transaction from PO #
		o_je.setValue('custbody_crtd_from_txn', context.newRecord.id);//set custbody_crtd_from_txn to ITM ID
		o_je.setValue('custbody_crtd_from_transaction_id_txt', context.newRecord.id);//set custbody_crtd_from_transaction_id_txt as ITM ID for deletion


		//loop through a_glLines 
		if(isNotNull(o_rep1)){//add lines for rep 1
			var d_rep1Cont = (pctToNumber(o_rep1.contribution)/100);
			log.debug('rep 1 create je', d_rep1Cont);
			
			if (subsidiaryID == '7'){//Optiv Inc
				rep1_location = o_rep1.inc_location;
				//nlapiLogExecution('DEBUG', 'Inc Location', location);
			}
			else if(subsidiaryID == '11'){//Optiv Canada
				rep1_location = o_rep1.canada_location;//field for Canada Location
				//nlapiLogExecution('DEBUG', 'Can Location', location);

			}
			else if(subsidiaryID == '3'){ //Optiv Federal
				rep1_location = o_rep1.fed_location;//field for Federal location
				//nlapiLogExecution('DEBUG', 'Fed Location', location);

			}
		}
		if(isNotNull(o_rep2)){//add lines for rep 2
			var d_rep2Cont = (pctToNumber(o_rep2.contribution)/100);
			
			hasRep2 = true;
			if (subsidiaryID == '7'){//Optiv Inc
				rep2_location = o_rep2.inc_location;
				//nlapiLogExecution('DEBUG', 'Inc Location', location);
			}
			else if(subsidiaryID == '11'){//Optiv Canada
				rep2_location = o_rep2.canada_location;//field for Canada Location
				//nlapiLogExecution('DEBUG', 'Can Location', location);

			}
			else if(subsidiaryID == '3'){ //Optiv Federal
				rep2_location = o_rep2.fed_location;//field for Federal location
				//nlapiLogExecution('DEBUG', 'Fed Location', location);

			}
		}
		if(isNotNull(o_rep3)){//add lines for rep 3
			var d_rep3Cont = (pctToNumber(o_rep3.contribution)/100);

			hasRep3 = true;
			if (subsidiaryID == '7'){//Optiv Inc
				rep3_location = o_rep3.inc_location;
				//nlapiLogExecution('DEBUG', 'Inc Location', location);
			}
			else if(subsidiaryID == '11'){//Optiv Canada
				rep3_location = o_rep3.canada_location;//field for Canada Location
				//nlapiLogExecution('DEBUG', 'Can Location', location);

			}
			else if(subsidiaryID == '3'){ //Optiv Federal
				rep3_location = o_rep3.fed_location;//field for Federal location
				//nlapiLogExecution('DEBUG', 'Fed Location', location);

			}
		}
			
			

		//var str = o_rep1.contribution.toString();
		log.debug('Rep 1 Info', 'Department: ' + o_rep1.department +
				' Location: '+rep1_location +
				' Contribution: '+ o_rep1.contribution+
				' Contribution Number: '+pctToNumber(o_rep1.contribution)+
				' Contribution Decimal Number: '+d_rep1Cont);

		for(var i = 0; i < a_LineObj.length; i++){
			var rep1_amount = to2Decimal(a_LineObj[i].amount * d_rep1Cont);
			log.debug('Line '+(i+1)+' Fields', 'Item: ' + a_LineObj[i].item + ' Class: '+a_LineObj[i].classID 
					+ ' Line Amount: '+a_LineObj[i].amount + ' AR JE: '+isARJE+ ' Rep 1 % Amount: '+rep1_amount);
			var rep1_cost = 0, rep1_gp = 0;
			
			if(isARJE){
				rep1_cost = a_LineObj[i].cost * d_rep1Cont; 
				rep1_gp = a_LineObj[i].grossProfit * d_rep1Cont;
			}
			//set Debit line for rep 1
			log.debug("accounts debit/credit", aa_accounts['debit'] + ' ' + aa_accounts['credit']);
			o_je.selectNewLine('line');
			o_je.setCurrentSublistValue('line', 'account', aa_accounts['debit']);
			o_je.setCurrentSublistValue('line', 'debit', rep1_amount);
			o_je.setCurrentSublistValue('line', 'department', o_rep1.department);
			o_je.setCurrentSublistValue('line', 'location', rep1_location);
			o_je.setCurrentSublistValue('line', 'class', a_LineObj[i].classID);
			o_je.setCurrentSublistValue('line', 'entity', entity);
			o_je.setCurrentSublistValue('line', 'custcol_journal_item', a_LineObj[i].item);
			o_je.setCurrentSublistValue('line', 'custcol_so_line_id', a_LineObj[i].lineID);
			o_je.setCurrentSublistValue('line', 'custcol_sales_rep', o_rep1.internalId);
			o_je.setCurrentSublistValue('line', 'custcol_qty', a_LineObj[i].qty);
			if(isARJE){
				log.debug("should not be in here for AP line 760", isARJE);
				o_je.setCurrentSublistValue('line', 'custcol_total_cost', rep1_cost);
				o_je.setCurrentSublistValue('line', 'custcol_gross_profit', rep1_gp);
				o_je.setCurrentSublistValue('line', 'custcol_gross_profit_pct', a_LineObj[i].gpPct);
			}
			//o_je.setCurrentSublistValue('line', 'memo', employee );
			o_je.commitLine('line');

			//set Credit Line
			o_je.selectNewLine('line');
			o_je.setCurrentSublistValue('line', 'account', aa_accounts['credit']);
			o_je.setCurrentSublistValue('line', 'credit', rep1_amount);
			o_je.setCurrentSublistValue('line', 'department', o_rep1.department);
			o_je.setCurrentSublistValue('line', 'location', rep1_location);
			o_je.setCurrentSublistValue('line', 'class', a_LineObj[i].classID);
			o_je.setCurrentSublistValue('line', 'entity', entity);
			o_je.setCurrentSublistValue('line', 'custcol_journal_item', a_LineObj[i].item);
			o_je.setCurrentSublistValue('line', 'custcol_so_line_id', a_LineObj[i].lineID);
			o_je.setCurrentSublistValue('line', 'custcol_sales_rep', o_rep1.internalId);
			o_je.setCurrentSublistValue('line', 'custcol_qty', a_LineObj[i].qty);
			if(isARJE){
				o_je.setCurrentSublistValue('line', 'custcol_total_cost', rep1_cost);
				o_je.setCurrentSublistValue('line', 'custcol_gross_profit', rep1_gp);
				o_je.setCurrentSublistValue('line', 'custcol_gross_profit_pct', a_LineObj[i].gpPct);
			}
			//o_je.setCurrentSublistValue('line', 'memo', employee );
			o_je.commitLine('line');

			
			if(hasRep2){
				var rep2_amount = to2Decimal(a_LineObj[i].amount * d_rep2Cont);
					
				log.debug('Rep 2 Info', 'Department: ' + o_rep2.department +
						' Location: '+rep2_location +
						' Contribution: '+ o_rep2.contribution+
						' Contribution Number: '+pctToNumber(o_rep2.contribution)+
						' Contribution Decimal Number: '+d_rep2Cont);
				log.debug('Line '+(i+1)+' Fields', 'Item: ' + a_LineObj[i].item + ' Class: '+a_LineObj[i].classID 
						+ ' Line Amount: '+a_LineObj[i].amount + ' AR JE: '+isARJE+ ' Rep 2 % Amount: '+rep2_amount);	
				var rep2_cost = 0, rep2_gp = 0;

				if(isARJE){
					rep2_cost = a_LineObj[i].cost * d_rep2Cont; 
					rep2_gp = a_LineObj[i].grossProfit * d_rep2Cont;
				}				
				//set Debit line for rep 2
				o_je.selectNewLine('line');
				o_je.setCurrentSublistValue('line', 'account', aa_accounts['debit']);
				o_je.setCurrentSublistValue('line', 'debit', rep2_amount);
				o_je.setCurrentSublistValue('line', 'department', ((isARJE && !isRTRN)||(!isARJE && isRTRN))?o_rep1.department:o_rep2.department);
				o_je.setCurrentSublistValue('line', 'location', ((isARJE && !isRTRN)||(!isARJE && isRTRN))?rep1_location:rep2_location);
				o_je.setCurrentSublistValue('line', 'class', a_LineObj[i].classID);
				o_je.setCurrentSublistValue('line', 'entity', entity);
				o_je.setCurrentSublistValue('line', 'custcol_journal_item', a_LineObj[i].item);
				o_je.setCurrentSublistValue('line', 'custcol_so_line_id', a_LineObj[i].lineID);
				o_je.setCurrentSublistValue('line', 'custcol_sales_rep', ((isARJE && !isRTRN)||(!isARJE && isRTRN))?o_rep1.internalId:o_rep2.internalId);
				o_je.setCurrentSublistValue('line', 'custcol_qty', a_LineObj[i].qty);
				if(isARJE){
					o_je.setCurrentSublistValue('line', 'custcol_total_cost', ((isARJE && !isRTRN)||(!isARJE && isRTRN))?rep1_cost:rep2_cost);
					o_je.setCurrentSublistValue('line', 'custcol_gross_profit', ((isARJE && !isRTRN)||(!isARJE && isRTRN))?rep1_gp:rep2_gp);
					o_je.setCurrentSublistValue('line', 'custcol_gross_profit_pct', a_LineObj[i].gpPct);
				}
				//o_je.setCurrentSublistValue('line', 'memo', employee );
				o_je.commitLine('line');
				//set Credit Line
				o_je.selectNewLine('line');
				o_je.setCurrentSublistValue('line', 'account', aa_accounts['credit']);
				o_je.setCurrentSublistValue('line', 'credit', rep2_amount);
				o_je.setCurrentSublistValue('line', 'department', ((isARJE && isRTRN) || (!isARJE && !isRTRN))?o_rep1.department:o_rep2.department);
				o_je.setCurrentSublistValue('line', 'location', ((isARJE && isRTRN) || (!isARJE && !isRTRN))?rep1_location:rep2_location);
				o_je.setCurrentSublistValue('line', 'class', a_LineObj[i].classID);
				o_je.setCurrentSublistValue('line', 'entity', entity);
				o_je.setCurrentSublistValue('line', 'custcol_journal_item', a_LineObj[i].item);
				o_je.setCurrentSublistValue('line', 'custcol_so_line_id', a_LineObj[i].lineID);
				o_je.setCurrentSublistValue('line', 'custcol_sales_rep', ((isARJE && isRTRN) || (!isARJE && !isRTRN))?o_rep1.internalId:o_rep2.internalId);
				o_je.setCurrentSublistValue('line', 'custcol_qty', a_LineObj[i].qty);
				if(isARJE){
					o_je.setCurrentSublistValue('line', 'custcol_total_cost', ((isARJE && isRTRN) || (!isARJE && !isRTRN))?rep1_cost:rep2_cost);
					o_je.setCurrentSublistValue('line', 'custcol_gross_profit', ((isARJE && isRTRN) || (!isARJE && !isRTRN))?rep1_gp:rep2_gp);
					o_je.setCurrentSublistValue('line', 'custcol_gross_profit_pct', a_LineObj[i].gpPct);
				}
				//o_je.setCurrentSublistValue('line', 'memo', employee );
				o_je.commitLine('line');
				
				if(hasRep3){
					var rep3_amount = to2Decimal(a_LineObj[i].amount * d_rep3Cont);
					log.debug('Rep 3 Info', 'Department: ' + o_rep3.department +
							' Location: '+rep3_location +
							' Contribution: '+ o_rep3.contribution+
							' Contribution Number: '+pctToNumber(o_rep3.contribution)+
							' Contribution Decimal Number: '+d_rep3Cont);
					log.debug('Line '+(i+1)+' Fields', 'Item: ' + a_LineObj[i].item + ' Class: '+a_LineObj[i].classID 
							+ ' Line Amount: '+a_LineObj[i].amount + ' AR JE: '+isARJE+ ' Rep 3 % Amount: '+rep3_amount);
					
					var rep3_cost = 0, rep3_gp = 0;

					if(isARJE){
						rep3_cost = a_LineObj[i].cost * d_rep3Cont; 
						rep3_gp = a_LineObj[i].grossProfit * d_rep3Cont;
					}
					//set Debit line for rep 2
					o_je.selectNewLine('line');
					o_je.setCurrentSublistValue('line', 'account', aa_accounts['debit']);
					o_je.setCurrentSublistValue('line', 'debit', rep3_amount);
					o_je.setCurrentSublistValue('line', 'department', ((isARJE && !isRTRN)||(!isARJE && isRTRN))?o_rep1.department:o_rep3.department);
					o_je.setCurrentSublistValue('line', 'location', ((isARJE && !isRTRN)||(!isARJE && isRTRN))?rep1_location:rep3_location);
					o_je.setCurrentSublistValue('line', 'class', a_LineObj[i].classID);
					o_je.setCurrentSublistValue('line', 'entity', entity);
					o_je.setCurrentSublistValue('line', 'custcol_journal_item', a_LineObj[i].item);
					o_je.setCurrentSublistValue('line', 'custcol_so_line_id', a_LineObj[i].lineID);
					o_je.setCurrentSublistValue('line', 'custcol_sales_rep', ((isARJE && !isRTRN)||(!isARJE && isRTRN))?o_rep1.internalId:o_rep3.internalId);
					o_je.setCurrentSublistValue('line', 'custcol_qty', a_LineObj[i].qty);
					if(isARJE){
						o_je.setCurrentSublistValue('line', 'custcol_total_cost', ((isARJE && !isRTRN)||(!isARJE && isRTRN))?rep1_cost:rep3_cost);
						o_je.setCurrentSublistValue('line', 'custcol_gross_profit',((isARJE && !isRTRN)||(!isARJE && isRTRN))?rep1_gp: rep3_gp);
						o_je.setCurrentSublistValue('line', 'custcol_gross_profit_pct', a_LineObj[i].gpPct);
					}
					//o_je.setCurrentSublistValue('line', 'memo', employee );
					o_je.commitLine('line');
					//set Credit Line
					o_je.selectNewLine('line');
					o_je.setCurrentSublistValue('line', 'account', aa_accounts['credit']);
					o_je.setCurrentSublistValue('line', 'credit', rep3_amount);
					o_je.setCurrentSublistValue('line', 'department', ((isARJE && isRTRN) || (!isARJE && !isRTRN))?o_rep1.department:o_rep3.department);
					o_je.setCurrentSublistValue('line', 'location', ((isARJE && isRTRN) || (!isARJE && !isRTRN))?rep1_location:rep3_location);
					o_je.setCurrentSublistValue('line', 'class', a_LineObj[i].classID);
					o_je.setCurrentSublistValue('line', 'entity', entity);
					o_je.setCurrentSublistValue('line', 'custcol_journal_item', a_LineObj[i].item);
					o_je.setCurrentSublistValue('line', 'custcol_so_line_id', a_LineObj[i].lineID);
					o_je.setCurrentSublistValue('line', 'custcol_sales_rep', ((isARJE && isRTRN) || (!isARJE && !isRTRN))?o_rep1.internalId:o_rep3.internalId);
					o_je.setCurrentSublistValue('line', 'custcol_qty', a_LineObj[i].qty);
					if(isARJE){
						o_je.setCurrentSublistValue('line', 'custcol_total_cost', ((isARJE && isRTRN) || (!isARJE && !isRTRN))?rep1_cost:rep2_cost);
						o_je.setCurrentSublistValue('line', 'custcol_gross_profit', ((isARJE && isRTRN) || (!isARJE && !isRTRN))?rep1_gp:rep2_gp);
						o_je.setCurrentSublistValue('line', 'custcol_gross_profit_pct', a_LineObj[i].gpPct);
					}
					//o_je.setCurrentSublistValue('line', 'memo', employee );
					o_je.commitLine('line');
				}
			}
		}
	 
		o_je.setValue('postingperiod', parseInt(postingPeriod));

		var jeID = o_je.save();

		return jeID;
	}
	
	/**
	 * Update related Journal entry when Fulfillment/Receipt is updated 
	 * as of 10-8-15 only built to update date and period to keep matched
	 * 
	 * @param jeID - Internal ID of Journal created
	 * @param recDate - Date of Fulfillment/Receipt
	 * @param recPostPeriod - Posting Period of Fulfillment/Receipt
	 */
	function updateJE(jeID, recDate, recPostPeriod){
		var o_je = record.load({type: record.Type.JOURNAL_ENTRY, id: jeID});
		o_je.setValue('trandate', recDate);
		o_je.setValue('postingperiod', recPostPeriod);
	    o_je.save();
	}


	/**
	 * Checks if classID is part of ASP
	 * ASP list of IDs taken as of 8/12/2015
	 * 
	 * @param classID Internal ID of Class
	 * @returns {Boolean} Whether it is in one of the ASP classes or not
	 */
	function isASP(classID){
		return (classID == 51 || classID == 52 || classID == 53);
	}

	/**
	 * Using Rick Calder's answer from here: http://stackoverflow.com/questions/15762768/javascript-math-round-to-two-decimal-places 
	 * 
	 * Rounds number to 2 decimal places without converting to string 
	 * 
	 * @param number Number to be rounded
	 * @returns {Number} Value of number rounded to 2 decimal places
	 */
	function to2Decimal(number){
			return +((number).toFixed(2));
	}
	

	/**
	 * Takes a string representing a percent and returns it as a number for numeric calculations
	 * 37.5% returns 37.5 - additional division would be needed if desired for .375 
	 *  
	 * @param s_pct String of Percentage
	 * @returns value of Percent as a number. 
	 */
	function pctToNumber(s_pct){
		log.debug('s_pct', s_pct);
		return s_pct;
	}


	/**
	 * Determines if the order is legacy based on transaction date. 
	 * If the date is before 7/1/2015 it is legacy
	 *  
	 * @param d_date
	 * @returns {Boolean}
	 */
	function isLegacy_date(d_date){
		d_date.setHours(0,0,0,0);
		var date_compare = new Date(2015,06,1);
		date_compare.setHours(0,0,0,0);
		
		return (d_date < date_compare);
		
	}

	/**
	 * Determines if s_string is null or empty
	 * @param s_string
	 * @returns {Boolean}
	 */
	function isNull(s_string){
		return (s_string == null || s_string == '');
	}

	/**
	 * Determines if s_string is NOT null and not empty
	 * @param field_val
	 * @returns {Boolean}
	 */
	function isNotNull(field_val){
		return (field_val != '' && field_val != null);
	}
	/**
	 * 
	 * @param curr_text Text value of Currency
	 * @returns Internal ID based on AA of Text to ID
	 */
	function currencyTxtToID(curr_text){
		var currToISO = {};
		currToISO['US Dollar'] = 1;
		currToISO['British pound'] = 2;
		currToISO['Canadian Dollar'] = 3;
		currToISO['Euro'] = 4;
		currToISO['AUD'] = 5;
		currToISO['Japanese Yen'] = 6;
		currToISO['ANG'] = 7;

		return currToISO[curr_text];
	}

	/**
	 * 
	 * @param errorObj
	 * @returns readable string of error message
	 */
	function getErrorMsg(errorObj)
	{
		var errMessage = errorObj;
		if (errMessage == '[object nlobjError]') 
			return trim(errMessage.getDetails() + errMessage.getStackTrace()).replace("\n", " ");
		else 
			return errorObj.toString().replace("\n", " ");
	} 
	function checkRecType(recType){
	    //log.debug('check rec type function', recType);

		var regexITM_Ful = new RegExp("^itemfulfillment", "i");
		var regexITM_Rec = new RegExp("^itemreceipt", "i");


		if(regexITM_Ful.test(recType)){
			return record.Type.ITEM_FULFILLMENT;
		} 
		if(regexITM_Rec.test(recType)){
		   	return record.Type.ITEM_RECEIPT;
		}
	} 

});

