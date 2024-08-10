const validator = require("validator");
const VerificationEmailModel = require("../db/models/verificationEmailModel");
const UserModel = require("../db/models/userModel");
const {
  generateOtp,
  sendMail,
  preCheckValidations,
  makeHashText,
  verifyOtp,
  sendOtp,
  REG_TYPES,
  loginUserFunction,
  generateJwtToken,
  verifyOtpAndPassword,
} = require("../utils/constants");
const ProductModel = require("../db/models/productModel");

const registerShopOrAdmin = async (req, res) => {
  try {
    const {
      email,
      password,
      confirm_password,
      name,
      role,
      user_id,
      image,
      contact_email,
      contact_mobile_number,
    } = req.body;
    const response = await preCheckValidations({
      email,
      password,
      confirm_password,
      name,
      role,
      res,
      user_id,
      reg_type: REG_TYPES[0],
    });
    if (response === true) {
      //generating otp
      const otp = generateOtp();

      // hashing otp and password
      const hashedPassword = await makeHashText(password);
      const hashedOtp = await makeHashText(otp);

      const user = new UserModel({
        name,
        email,
        password: hashedPassword,
        role,
        user_id,
        image: image ? image : "DUMMY_PROFILE_LOGO.png",
        contact: {
          email: contact_email ? contact_email : email,
          mobile_number: contact_mobile_number ? contact_mobile_number : "",
        },
      });

      const verificationOtp = new VerificationEmailModel({
        user_id: user?._id,
        otp: hashedOtp,
      });

      const userDetails = await user.save();
      await verificationOtp.save();
      await sendMail(userDetails?.email, otp, userDetails?.name);

      const sendUserDetails = {
        id: userDetails?._id,
        name: userDetails?.name,
        verified: userDetails?.verified,
      };
      res.status(201).send({
        status: true,
        message: "OTP sent Successfully",
        data: {
          userDetails: sendUserDetails,
        },
      });
    }
  } catch (error) {
    res.status(400).send({ status: false, message: "Something Went Wrong" });
  }
};

const verifyShopOrAdminOtp = async (req, res) => {
  try {
    const { user_id, otp } = req.body;
    await verifyOtp({
      res,
      user_id,
      otp,
    });
  } catch (error) {
    res.status(400).send({ status: false, message: "Something Went Wrong" });
  }
};

const sendShopOrAdminOtp = async (req, res) => {
  try {
    const { user_id } = req.body;
    await sendOtp({ res, user_id });
  } catch (error) {
    res.status(400).send({ status: false, message: "Something Went Wrong" });
  }
};

const loginShopAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email?.toString()?.trim() || !password?.toString()?.trim()) {
      return res
        .status(400)
        .send({ status: false, message: "Fieds Should Not Be Empty" });
    }
    if (!validator.isEmail(email)) {
      await loginUserFunction({
        res,
        password,
        email,
        type: "user_id",
        reg_type: REG_TYPES[0],
      });
    } else {
      await loginUserFunction({
        res,
        password,
        email,
        type: "email",
        reg_type: REG_TYPES[0],
      });
    }
  } catch (error) {
    res.status(400).send({ status: false, message: "Something Went Wrong" });
  }
};

const updateShopAdmin = async (req, res) => {
  try {
    const { userDetails } = req.user;
    const requests = req.body;
    if (Object.keys(requests).length === 0) {
      return res
        .status(400)
        .send({ message: "Update Requests Should not be empty" });
    }

    const checkUserExist = await UserModel.findOne({
      user_id: userDetails?.user_id,
    });

    if (!checkUserExist) {
      return res.status(400).send({ message: "User Not Exist" });
    }

    const checkUserIsVerified = checkUserExist?.verified;
    if (!checkUserIsVerified) {
      return res
        .status(400)
        .send({ status: false, message: "User is Not Verified or Not Valid" });
    }

    const result = Object.keys(requests).some((key) => {
      // Skip certain keys
      if (["old_password", "new_password", "is_premium_user"].includes(key)) {
        return false;
      }
      // Check if the property is undefined or null in checkUserExist
      return checkUserExist[key] === undefined || checkUserExist[key] === null;
    });

    if (result) {
      return res.status(400).send({
        message: "Your trying to update the property which not exist",
      });
    }

    if (requests?.user_id && checkUserExist?.user_id !== requests?.user_id) {
      //if req has user id then check logged in user //updating user_id
      const findUserIdAlreadyExist = await UserModel.findOne({
        user_id: requests?.user_id,
      });
      if (findUserIdAlreadyExist) {
        return res.status(400).send({
          message: "Enterd User Id Already Exist ! Please try an new User Id",
        });
      }
    }

    if (requests?.role) {
      if (requests?.role !== checkUserExist?.role) {
        return res
          .status(400)
          .send({ message: "You are not allowed to change the type of user" });
      }
    }

    if (requests?.verified === true || requests?.verified === false) {
      if (requests?.verified !== checkUserExist?.verified) {
        return res
          .status(400)
          .send({ message: "You can verify your account by email validation" });
      }
    }

    if (requests?.old_password && requests?.new_password) {
      //check old password not equal to new pass
      if (requests?.old_password === requests?.new_password) {
        return res.status(400).send({
          message: "Current Password Should not be same as Old Password",
        });
      }

      const checkOldPassword = await verifyOtpAndPassword(
        checkUserExist?.password,
        requests?.old_password
      );

      if (!checkOldPassword) {
        return res
          .status(400)
          .send({ message: "Please Check Your Old Password" });
      }

      if (!validator.isStrongPassword(requests?.new_password)) {
        return res.status(400).send({
          message:
            "Password Not Meet the criteria, it Must includes(password length 8 or more charaters, 1 uppercase letter, 1 special symbol)",
        });
      }
      const hashedPassword = await makeHashText(requests?.new_password);
      delete requests?.old_password, requests?.new_password;

      const req = {
        ...requests,
        password: hashedPassword,
      };
      const updateUser = { ...checkUserExist._doc, ...req }; //getting response in {checkUserExist: {_doc: {userdetails}}}

      const checkAnyChangesMade =
        JSON.stringify(updateUser) !== JSON.stringify(checkUserExist);

      if (checkAnyChangesMade) {
        await UserModel.updateOne(
          { user_id: checkUserExist?.user_id },
          { $set: updateUser },
          { new: true }
        );
        if (checkUserExist?.role === "seller") {
          const filter = { seller_id: checkUserExist?.user_id };
          const updateDoc = { seller_id: requests?.user_id };
          await ProductModel.updateMany(filter, updateDoc);
        }
      }
    } else {
      const updateUser = { ...checkUserExist._doc, ...requests }; //getting response in {checkUserExist: {_doc: {userdetails}}}

      const checkAnyChangesMade =
        JSON.stringify(updateUser) !== JSON.stringify(checkUserExist);
      if (checkAnyChangesMade) {
        await UserModel.updateOne(
          { user_id: checkUserExist?.user_id },
          { $set: updateUser },
          { new: true }
        );
        if (checkUserExist?.role === "seller") {
          const filter = { seller_id: checkUserExist?.user_id };
          const updateDoc = { seller_id: requests?.user_id };
          await ProductModel.updateMany(filter, updateDoc);
        }
      }
    }

    const userDetailsAfterUpdate = await UserModel.findOne({
      user_id: requests?.user_id,
    });
    const details = {
      name: userDetailsAfterUpdate?.name,
      user_id: userDetailsAfterUpdate?.user_id,
      role: userDetailsAfterUpdate?.role,
    };
    const token = await generateJwtToken(details);
    const sendDetails = {
      name: userDetailsAfterUpdate?.name,
      user_id: userDetailsAfterUpdate?.user_id,
      role: userDetailsAfterUpdate?.role,
      verified: userDetailsAfterUpdate?.verified,
      image: userDetailsAfterUpdate?.image,
      address: userDetailsAfterUpdate?.address,
      contact: {
        email: userDetailsAfterUpdate?.contact?.email,
        mobile_number: userDetailsAfterUpdate?.contact?.mobile_number,
      },
      jwtToken: token,
    };
    res.status(200).send({
      status: true,
      message: "User Details updated successfully",
      data: {
        userDetails: sendDetails,
      },
    });
  } catch (error) {
    res.status(400).send({ status: false, message: "Something Went Wrong" });
  }
};

// forget password controllers
const forgetPasswordShopAdmin = async (req, res) => {
  try {
    const { email } = req.body;
    if (!validator.isEmail(email)) {
      return res
        .status(400)
        .send({ status: false, message: "Please Enter A Valid Email" });
    }
    const checkUserExist = await UserModel.findOne({ email });

    if (!checkUserExist) {
      return res.status(400).send({ status: false, message: "User Not Found" });
    }
    const findUserExistWithOtp = await VerificationEmailModel.findOne({
      user_id: checkUserExist?._id,
    });

    if (findUserExistWithOtp) {
      return res.status(400).send({
        status: false,
        message:
          "Please wait 5 mins to make another otp Request (Or) Check Ur Recent Otp on Mail",
      });
    }
    const otp = generateOtp();
    const hashedOtp = await makeHashText(otp);
    const verificationOtp = new VerificationEmailModel({
      user_id: checkUserExist?._id,
      otp: hashedOtp,
    });
    await verificationOtp.save();
    await sendMail(checkUserExist?.email, otp, checkUserExist?.name);

    const sendUserDetails = {
      id: checkUserExist?._id,
      name: checkUserExist?.name,
      verified: checkUserExist?.verified,
    };
    res.status(201).send({
      status: true,
      message: "OTP sent Successfully",
      data: {
        userDetails: sendUserDetails,
      },
    });
  } catch (error) {
    res.status(400).send({ status: false, message: "Something Went Wrong" });
  }
};

const verifyOtpForgetPasswordShopAdmin = async (req, res) => {
  try {
    const { user_id, otp } = req.body;

    const checkUserExist = await UserModel.findOne({
      _id: user_id,
    });

    if (!checkUserExist) {
      return res.status(404).send({
        status: false,
        message: "User Not Exists",
      });
    }
    const findUserExistWithOtp = await VerificationEmailModel.findOne({
      user_id,
    });

    if (!findUserExistWithOtp) {
      return res.status(404).send({
        status: false,
        message: "OTP Expired, Make Another OTP Request",
      });
    }

    const result = await verifyOtpAndPassword(findUserExistWithOtp?.otp, otp);

    if (!result) {
      return res.status(400).send({
        status: false,
        message: "Otp is invalid",
      });
    }

    await VerificationEmailModel.findByIdAndDelete(findUserExistWithOtp?._id);

    const sendDetails = {
      id: checkUserExist?._id,
    };
    res.status(200).send({
      status: true,
      message: "User Verified Successfully, update your password",
      data: {
        userDetails: sendDetails,
      },
    });
  } catch (error) {
    res.status(400).send({ status: false, message: "Something Went Wrong" });
  }
};

const updatePasswordShopAdmin = async (req, res) => {
  try {
    const { password, confirm_password, user_id } = req.body;
    if (password?.toString()?.trim() !== confirm_password?.toString()?.trim()) {
      return res.status(400).send({
        status: false,
        message: "Both Passwords should Match",
      });
    }

    if (!validator.isStrongPassword(password)) {
      return res.status(400).send({
        status: false,
        message:
          "Password Not Meet the criteria, it Must includes(password length 8 or more charaters, 1 uppercase letter, 1 special symbol)",
      });
    }

    const findUserDetails = await UserModel.findOne({
      _id: user_id,
    });

    const comparePassword = await verifyOtpAndPassword(
      findUserDetails?.password,
      password
    );

    if (comparePassword) {
      return res.status(400).send({
        status: false,
        message: "current password should not same as old password",
      });
    }
    const hashedPassword = await makeHashText(password);

    await UserModel.updateOne(
      { _id: user_id },
      { $set: { password: hashedPassword } }
    );
    res
      .status(200)
      .send({ status: true, message: "Password Updated Successfully" });
  } catch (error) {
    res.status(400).send({ status: false, message: "Something Went Wrong" });
  }
};

module.exports = {
  registerShopOrAdmin,
  verifyShopOrAdminOtp,
  sendShopOrAdminOtp,
  loginShopAdmin,
  updateShopAdmin,
  forgetPasswordShopAdmin,
  updatePasswordShopAdmin,
  verifyOtpForgetPasswordShopAdmin,
};
