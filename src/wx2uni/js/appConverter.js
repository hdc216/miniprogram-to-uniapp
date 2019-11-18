const t = require('@babel/types');
const nodePath = require('path');
const generate = require('@babel/generator').default;
const traverse = require('@babel/traverse').default;
const Vistor = require("./Vistor");
const clone = require('clone');
const pathUtil = require('../../utils/pathUtil');
const babelUtil = require('../../utils/babelUtil');


//
let vistors = {};

//外部定义的变量
let declareStr = '';

//data对象
let dataValue = {};

//globalData对象
let globalData = {};

//当前文件所在目录
let fileDir = "";

/*
 *
 * 注：为防止深层遍历，将直接路过子级遍历，所以使用enter进行全遍历时，孙级节点将跳过
 * 
 */
const vistor = {
	ExpressionStatement(path) {
		if (t.isCallExpression(path.node.expression)) {
			const calleeName = t.isIdentifier(path.node.expression.callee) ? path.node.expression.callee.name.toLowerCase() : "";
			const parent = path.parentPath.parent;
			if (t.isFile(parent) && calleeName != "app" && calleeName != "page" && calleeName != "component" && calleeName != "vantcomponent") {
				//定义的外部函数
				declareStr += `${generate(path.node).code}\r\n`;
				path.skip();
			}
		} else if (t.isAssignmentExpression(path.node.expression)) {
			//有可能app.js里是这种结构，exports.default = App({});
			//path.node 为AssignmentExpression类型，所以这里区分一下
			declareStr += `${generate(path.node).code}\r\n`;
		}
	},
	ImportDeclaration(path) {
		//定义的导入的模块
		// vistors.importDec.handle(path.node);
		//
		//处理import模板的路径，转换当前路径以及根路径为相对路径
		let filePath = path.node.source.value;
		filePath = nodePath.join(nodePath.dirname(filePath), pathUtil.getFileNameNoExt(filePath)); //去掉扩展名
		filePath = pathUtil.relativePath(filePath, global.miniprogramRoot, fileDir);
		path.node.source.value = filePath;

		var str = `${generate(path.node).code}\r\n`;
		//
		declareStr += str;
		path.skip();
	},
	VariableDeclaration(path) {
		//将require()里的地址都处理一遍
		traverse(path.node, {
			noScope: true,
			CallExpression(path2) {
				let callee = path2.get("callee");
				let property = path2.get("property");
				if (t.isIdentifier(callee.node, { name: "require" })) {
					let arguments = path2.node.arguments;
					if (arguments && arguments.length) {
						if (t.isStringLiteral(arguments[0])) {
							let filePath = arguments[0].value;
							filePath = pathUtil.relativePath(filePath, global.miniprogramRoot, fileDir);
							path2.node.arguments[0] = t.stringLiteral(filePath);
						}
					}
				}
			},
			VariableDeclarator(path2) {
				if (t.isMemberExpression(path2.node.init) && path2.node.init.object) {
					let id = path2.node.id;
					let init = path2.node.init;
					let property = init.property;
					let objectPath = path2.node.init.object;
					let subOject = objectPath.object;
					let subProperty = objectPath.property;
					if (t.isIdentifier(subOject, { name: "app" })) {
						//这里没法调babelUtil.globalDataHandle()，子节点没有replaceWidth方法了(或许有转换方法，暂未知)
						let getApp = t.callExpression(t.identifier('getApp'), []);
						let subMe = t.MemberExpression(t.MemberExpression(getApp, t.identifier('globalData')), subProperty);
						let me = t.MemberExpression(subMe, property);
						let vd = t.variableDeclarator(path2.node.id, me);
						path.replaceWith(vd);
						path.skip();
					}
				} else if (t.isCallExpression(path2.node.init)) {
					//处理外部声明的require，如var md5 = require("md5.js");
					const initPath = path2.node.init;
					let callee = initPath.callee;
					if (t.isIdentifier(callee, { name: "require" })) {
						let arguments = initPath.arguments;
						if (arguments && arguments.length) {
							if (t.isStringLiteral(arguments[0])) {
								let filePath = arguments[0].value;
								filePath = pathUtil.relativePath(filePath, global.miniprogramRoot, fileDir);
								initPath.arguments[0] = t.stringLiteral(filePath);
							}
						}
					}
				}
			}
		});
		const parent = path.parentPath.parent;
		if (t.isFile(parent)) {
			//定义的外部变量
			// vistors.variable.handle(path.node);
			declareStr += `${generate(path.node).code}\r\n`;
			path.skip();
		}
	},
	FunctionDeclaration(path) {
		const parent = path.parentPath.parent;
		if (t.isFile(parent)) {
			//定义的外部函数
			declareStr += `${generate(path.node).code}\r\n`;
			path.skip();
		}
	},
	ObjectMethod(path) {
		const parent = path.parentPath.parent;
		const value = parent.value;
		const name = path.node.key.name;
		// console.log("add methods： ", name);
		if (value) {
			//async函数
			//app.js里面的函数，除生命周期外全部放入到gloabalData里
			if (globalData.value && globalData.value.properties) {
			} else {
				globalData = babelUtil.createObjectProperty("globalData");
				vistors.lifeCycle.handle(globalData);
			}
			globalData.value.properties.push(path.node);
		} else {
			//这里function
			if (babelUtil.lifeCycleFunction[name]) {
				//value为空的，可能是app.js里的生命周期函数
				vistors.lifeCycle.handle(path.node);
			} else {
				//类似这种函数 fun(){} 
				if (globalData.value && globalData.value.properties) {
				} else {
					globalData = babelUtil.createObjectProperty("globalData");
					vistors.lifeCycle.handle(globalData);
				}
				globalData.value.properties.push(path.node);
			}
		}
		path.skip();
	},

	ObjectProperty(path) {
		const name = path.node.key.name;
		// console.log("name", path.node.key.name)
		// console.log("name", path.node.key.name)
		switch (name) {
			case 'data':
				if (globalData.value && globalData.value.properties) {
				} else {
					globalData = babelUtil.createObjectProperty("globalData");
					vistors.lifeCycle.handle(globalData);
				}
				if (path.node.value && path.node.value.properties) {
					globalData.value.properties = [...globalData.value.properties, ...path.node.value.properties];
				}
				path.skip();
				break;
			case 'globalData':
				//只让第一个globalData进来，暂时不考虑其他奇葩情况
				if (JSON.stringify(globalData) == "{}") {
					//第一个data，存储起来
					globalData = path.node;
					vistors.lifeCycle.handle(globalData);
				} else {
					globalData.value.properties = [...globalData.value.properties, ...path.node.value.properties];
				}
				path.skip();
				break;
			default:
				const parent = path.parentPath.parent;
				const value = parent.value;
				// console.log("name", path.node.key.name)
				//如果父级不为data时，那么就加入生命周期，比如app.js下面的全局变量
				if (value && value == dataValue) {
					vistors.data.handle(path.node);

					//如果data下面的变量为数组时，不遍历下面的内容，否则将会一一列出来
					if (path.node.value && t.isArrayExpression(path.node.value)) path.skip();
				} else {
					const node = path.node.value;
					if (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node) || t.isObjectExpression(node)) {
						//这里function
						if (babelUtil.lifeCycleFunction[name]) {
							// console.log("add lifeCycle： ", name);
							vistors.lifeCycle.handle(path.node);
							//跳过生命周期下面的子级，不然会把里面的也给遍历出来
						} else {
							globalData.value.properties.push(path.node);
						}
						path.skip();
					} else if (t.isCallExpression(node)) {
						globalData.value.properties.push(path.node);
					} else {
						if (globalData.value && globalData.value.properties) {
						} else {
							globalData = babelUtil.createObjectProperty("globalData");
							vistors.lifeCycle.handle(globalData);
						}
						globalData.value.properties.push(path.node);
					}
				}
				break;
		}
	}
}

/**
 * 转换
 * @param {*} ast               ast
 * @param {*} _file_js          当前转换的文件路径
 * @param {*} isVueFile         是否为vue文件
 */
const appConverter = function (ast, _file_js, isVueFile) {
	//清空上次的缓存
	declareStr = '';
	//data对象
	dataValue = {};
	//globalData对象
	globalData = {};
	fileDir = nodePath.dirname(_file_js);
	//
	vistors = {
		props: new Vistor(),
		data: new Vistor(),
		events: new Vistor(),
		computed: new Vistor(),
		components: new Vistor(),
		watch: new Vistor(),
		methods: new Vistor(),
		lifeCycle: new Vistor(),
	}

	traverse(ast, vistor);

	return {
		convertedJavascript: ast,
		vistors: vistors,
		declareStr, //定义的变量和导入的模块声明
	}
}

module.exports = appConverter;
